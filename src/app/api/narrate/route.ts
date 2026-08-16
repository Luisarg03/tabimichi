import { NextRequest, NextResponse } from "next/server";
import { getWeather, weatherAt } from "@/lib/weather";
import { narrateTop } from "@/lib/llm";
import { jstHourStamp } from "@/lib/jst";
import { logEntry } from "@/lib/logger";
import type { NarratePlaceInput, NarrateResponse } from "@/lib/types";

export const runtime = "nodejs";

interface NarrateBody {
  lat: number;
  lng: number;
  budget: "lunch" | "afternoon" | "full_day";
  mode: "walking" | "transit" | "car";
  types: string[];
  lang?: string;
  /** ISO instant — the narration is evaluated at this simulated time */
  now?: string;
  /** optional interest keyword, so the guide tailors the summary */
  keyword?: string;
  /** dev trace id correlating with the recommend phase */
  traceId?: string;
  places: NarratePlaceInput[];
}

/**
 * Phase 2 of the pipeline: the LLM writes the day summary + per-place "why".
 * Called asynchronously by the client after the fast recommend response.
 */
export async function POST(req: NextRequest) {
  let body: NarrateBody;
  try {
    body = (await req.json()) as NarrateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { lat, lng, budget, mode = "transit", types = [], lang = "es", now, traceId, keyword, places = [] } = body ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Array.isArray(places) || places.length === 0) {
    return NextResponse.json({ error: "lat/lng + places required" }, { status: 400 });
  }
  if (!["lunch", "afternoon", "full_day"].includes(budget)) {
    return NextResponse.json({ error: "invalid budget" }, { status: 400 });
  }
  if (!["walking", "transit", "car"].includes(mode)) {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }

  let weather = await getWeather(lat, lng);
  const simulated = now ? new Date(now) : null;
  if (simulated) weather = weatherAt(weather, jstHourStamp(simulated));

  const scored = places.map((p) => ({
    id: p.id,
    source: "overpass" as const, // source is irrelevant for narration
    name: p.name,
    lat,
    lng,
    tags: p.tags,
    rating: p.rating,
    distanceKm: p.distanceKm,
    travelMin: p.travelMin,
    score: 50,
    reasons: [],
  }));

  const startedAt = performance.now();
  const { narratives, summary, provider } = await narrateTop({
    places: scored,
    weather,
    budget,
    mode,
    lang: lang === "en" ? "en" : "es",
    types,
    keyword,
  });

  logEntry({
    type: "narrate",
    traceId,
    lat,
    lng,
    budget,
    mode,
    lang,
    keyword,
    sim: simulated !== null,
    provider,
    narratives: narratives.size,
    summary: Boolean(summary),
    ms: Math.round(performance.now() - startedAt),
  });

  const out: NarrateResponse = {
    summary,
    narratives: Object.fromEntries(narratives),
    narratedBy: provider,
  };
  return NextResponse.json(out);
}
