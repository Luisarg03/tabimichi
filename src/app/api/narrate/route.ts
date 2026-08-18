import { NextRequest, NextResponse } from "next/server";
import { getWeather, weatherAt } from "@/lib/weather";
import { narrateTop } from "@/lib/llm";
import { jstHourStamp } from "@/lib/jst";
import { logEntry } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security";
import { getUserKeys } from "@/lib/user-keys";
import type { NarratePlaceInput, NarrateResponse } from "@/lib/types";

export const runtime = "nodejs";

interface NarrateBody {
  lat: number;
  lng: number;
  budget: "lunch" | "afternoon" | "full_day";
  mode: "walking" | "transit" | "car";
  types: string[];
  lang?: string;
  now?: string;
  keyword?: string;
  traceId?: string;
  places: NarratePlaceInput[];
}

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
  if (places.length > 12) {
    return NextResponse.json({ error: "too many places" }, { status: 400 });
  }

  // Cost/abuse control: LLM calls burn the requesting user's quota.
  const limited = enforceRateLimit(req, "narrate", { perIp: 10, perUser: 30 });
  if (limited) return limited;

  try {
    const config = await getUserKeys(req);

    let weather = await getWeather(lat, lng);
    const simulated = now ? new Date(now) : null;
    if (simulated) weather = weatherAt(weather, jstHourStamp(simulated));

    const scored = places.map((p) => ({
      id: p.id, source: "overpass" as const, name: p.name, lat, lng,
      tags: p.tags, rating: p.rating, distanceKm: p.distanceKm,
      travelMin: p.travelMin, score: 50, reasons: [],
    }));

    const startedAt = performance.now();
    const { narratives, summary, provider } = await narrateTop({
      places: scored, weather, budget, mode,
      lang: lang === "en" ? "en" : "es", types, keyword,
      config,
    });

    logEntry({
      type: "narrate", traceId, lat, lng, budget, mode, lang, keyword,
      sim: simulated !== null, provider, narratives: narratives.size,
      summary: Boolean(summary), ms: Math.round(performance.now() - startedAt),
    });

    const out: NarrateResponse = { summary, narratives: Object.fromEntries(narratives), narratedBy: provider };
    return NextResponse.json(out);
  } catch (e) {
    console.error("[tabi] /api/narrate failed:", e);
    logEntry({ type: "error", route: "narrate", error: String(e) });
    return NextResponse.json({ error: "narrative_failed" }, { status: 502 });
  }
}
