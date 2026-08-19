import { NextRequest, NextResponse } from "next/server";
import {
  placeById,
  upsertPlace,
  photosVerified,
  setPhotosVerified,
  readCachedPhoto,
  writeCachedPhoto,
} from "@/lib/cache";
import { googlePlaceDetails, googlePhotoBytes } from "@/lib/places/google";
import { logEntry } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security";
import { getUserKeys } from "@/lib/user-keys";

export const runtime = "nodejs";
// allow slow external calls (Overpass, Google, LLM) past the default function timeout
export const maxDuration = 60;

// The results list now shows 30 cards — enrich the visible top with photos
// (BYOK cost: each id is one Place Details call + ≤3 photo downloads).
const MAX_ENRICH = 12;
const MAX_PHOTOS = 3;

/**
 * Async photo enrichment (BYOK): pulls extra refs from Google Place Details
 * with the requesting user's own key, ensures each ref is downloadable, and
 * caches the bytes in Supabase Storage (shared — each photo is downloaded
 * once). The `photos_verified` flag skips Place Details on repeat visits.
 */
export async function GET(req: NextRequest) {
  const startedAt = performance.now();
  const traceId = req.nextUrl.searchParams.get("trace") ?? undefined;
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_ENRICH);

  // Enrichment downloads photos with the user's own Google key: bound abuse.
  const limited = enforceRateLimit(req, "photos", { perIp: 30 });
  if (limited) return limited;

  const config = await getUserKeys(req);
  const key = config.googlePlacesApiKey;
  const photos: Record<string, string[]> = {};
  if (!key || ids.length === 0) return NextResponse.json({ photos });

  const queue = [...ids];

  async function refsFor(id: string): Promise<string[]> {
    const cached = await placeById(id);
    if (cached && (await photosVerified(id))) return cached.photoRefs ?? [];

    const refs = [...(cached?.photoRefs ?? [])];
    // pull more refs from Place Details (up to 8)
    const googleId = id.startsWith("g_") ? id.slice(2) : id;
    try {
      const details = await googlePlaceDetails(key, googleId);
      for (const r of details.photos) if (!refs.includes(r)) refs.push(r);
    } catch {
      // keep search refs
    }

    const kept = refs.slice(0, MAX_PHOTOS);
    // ensure each ref is fetchable and cached (best effort; keep ref anyway)
    await Promise.all(
      kept.map(async (ref) => {
        if (await readCachedPhoto(id, ref)) return;
        try {
          await writeCachedPhoto(id, ref, await googlePhotoBytes(key, ref));
        } catch {
          // unverifiable — keep the ref, the proxy will serve a placeholder
        }
      })
    );

    if (cached && kept.length > 0) {
      await upsertPlace({ ...cached, photoRefs: kept, photoRef: kept[0] });
    }
    await setPhotosVerified(id, true);
    return kept;
  }

  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift()!;
      try {
        photos[id] = await refsFor(id);
      } catch {
        photos[id] = [];
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  logEntry({
    type: "photos",
    traceId,
    ids: ids.length,
    enriched: Object.entries(photos).map(([id, refs]) => ({ id, photos: refs.length })),
    ms: Math.round(performance.now() - startedAt),
  });
  return NextResponse.json({ photos });
}
