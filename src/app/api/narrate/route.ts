import { NextRequest, NextResponse } from "next/server";
import { getWeather, weatherAt } from "@/lib/weather";
import { narrateTop } from "@/lib/llm";
import { jstHourStamp } from "@/lib/jst";
import { logEntry } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security";
import type { AppConfig } from "@/lib/settings";
import { getSupabaseAdmin, getSupabaseForUser } from "@/lib/supabase/server";
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

async function getKeysForRequest(
  req: NextRequest
): Promise<{ config: AppConfig; fromUserKeys: boolean }> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    try {
      const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
      if (user) {
        // User-scoped client; RLS restricts rows to this user
        const { data: keys } = await getSupabaseForUser(token)
          .from("api_keys")
          .select("key_name, key_value");
        if (keys && keys.length > 0) {
          const KEY_MAP: Record<string, keyof AppConfig> = {
            google_places: "googlePlacesApiKey",
            geoapify: "geoapifyApiKey",
            overpass_endpoint: "overpassEndpoint",
            opencode_zen: "opencodeApiKey",
            opencode_go: "opencodeGoApiKey",
          };
          const config: AppConfig = { googlePlacesApiKey: "", opencodeApiKey: "", opencodeGoApiKey: "", geoapifyApiKey: "", overpassEndpoint: "" };
          for (const row of keys) { const f = KEY_MAP[row.key_name]; if (f) config[f] = row.key_value; }
          return { config, fromUserKeys: true };
        }
      }
    } catch { /* fall through */ }
  }
  const { getConfig } = await import("@/lib/settings");
  return { config: getConfig(), fromUserKeys: false };
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

  // Cost/abuse control: LLM calls burn the operator's quota when no user keys
  // are configured — bound it per IP and per authenticated user.
  const limited = enforceRateLimit(req, "narrate", { perIp: 10, perUser: 30 });
  if (limited) return limited;

  try {
    const { config: keys } = await getKeysForRequest(req);

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
      config: keys,
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
