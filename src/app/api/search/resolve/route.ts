import { NextRequest, NextResponse } from "next/server";
import { logEntry } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security";
import { getUserKeys } from "@/lib/user-keys";
import { googlePlaceResolve } from "@/lib/places/google";

export const runtime = "nodejs";

/**
 * Resolve a Google Autocomplete prediction to coordinates at pick time —
 * exactly one Place Details call (fields geometry/name/types). BYOK: the
 * requesting user's own key; anonymous callers get 503 (nothing to spend).
 */
export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get("placeId")?.trim() ?? "";
  if (!placeId || placeId.length > 200) {
    return NextResponse.json({ error: "placeId required" }, { status: 400 });
  }

  const limited = enforceRateLimit(req, "search_resolve", { perIp: 60, perUser: 120 });
  if (limited) return limited;

  const config = await getUserKeys(req);
  const key = config.googlePlacesApiKey;
  if (!key) {
    return NextResponse.json({ error: "google key required" }, { status: 503 });
  }

  const startedAt = performance.now();
  try {
    const hit = await googlePlaceResolve(key, placeId);
    logEntry({
      type: "search_resolve",
      placeId: placeId.slice(0, 40),
      found: hit !== null,
      ms: Math.round(performance.now() - startedAt),
    });
    if (!hit) return NextResponse.json({ error: "not-found" }, { status: 404 });
    return NextResponse.json(hit);
  } catch (e) {
    logEntry({
      type: "search_resolve",
      placeId: placeId.slice(0, 40),
      error: String(e),
      ms: Math.round(performance.now() - startedAt),
    });
    return NextResponse.json({ error: "resolve failed" }, { status: 502 });
  }
}
