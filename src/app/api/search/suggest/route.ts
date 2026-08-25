import { NextRequest, NextResponse } from "next/server";
import { logEntry } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security";
import { searchPlaces, SUGGEST_LIMIT_MAX } from "@/lib/places/search";
import { getUserKeys } from "@/lib/user-keys";

export const runtime = "nodejs";

/** One CJK character is a valid search ("寺", "山") — anything else needs ≥2. */
function isValidQuery(q: string): boolean {
  const cjk = /[\u3040-\u30ff\u3400-\u9fff]/;
  return q.length >= 2 || (q.length === 1 && cjk.test(q));
}

/**
 * Unified place/address autocomplete. Local pool (instant) + Photon +
 * Nominatim raced concurrently; any failing source degrades to the rest.
 * Returns 200 with an empty list when nothing matched — never a 5xx from
 * remote errors (the UI shows a "no results" row instead).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!isValidQuery(q)) {
    return NextResponse.json({ error: "q required (min 2 chars)" }, { status: 400 });
  }

  // Called per keystroke (client debounced 250 ms): allow a burst, then cap.
  const limited = enforceRateLimit(req, "search_suggest", { perIp: 60 });
  if (limited) return limited;

  // Bias is optional: Number(null) is 0, so only parse present params —
  // otherwise suggestions would be ranked by distance to (0,0).
  const latParam = req.nextUrl.searchParams.get("lat");
  const lngParam = req.nextUrl.searchParams.get("lng");
  const lat = latParam ? Number(latParam) : NaN;
  const lng = lngParam ? Number(lngParam) : NaN;
  const lang = req.nextUrl.searchParams.get("lang") ?? undefined;
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 8, SUGGEST_LIMIT_MAX);

  const startedAt = performance.now();
  try {
    // BYOK: with a session JWT the user's Google key adds Autocomplete
    // predictions (Google's own ranking) on top of the free sources.
    const config = await getUserKeys(req);
    const { suggestions, sources } = await searchPlaces({
      q,
      lang,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      limit,
      googleKey: config.googlePlacesApiKey || undefined,
    });
    logEntry({
      type: "search_suggest",
      query: q,
      sources,
      count: suggestions.length,
      ms: Math.round(performance.now() - startedAt),
    });
    return NextResponse.json({ suggestions });
  } catch (e) {
    logEntry({
      type: "search_suggest",
      query: q,
      error: String(e),
      ms: Math.round(performance.now() - startedAt),
    });
    // Degrade to an empty result — a dead backend must not break the UI.
    return NextResponse.json({ suggestions: [] });
  }
}
