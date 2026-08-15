import { NextRequest, NextResponse } from "next/server";
import { placeById, upsertPlace } from "@/lib/db";
import { googlePlacePhotos } from "@/lib/places/google";
import { getConfig } from "@/lib/settings";

export const runtime = "nodejs";

const MAX_ENRICH = 6;
const TARGET_PHOTOS = 3;

/**
 * Async photo enrichment: search APIs return ~1 photo per place; Place
 * Details returns up to 10. Called after the fast recommend response, so
 * the initial render is not blocked. Already-enriched places (≥3 refs)
 * are skipped, and merged refs are persisted to the cache.
 */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_ENRICH);

  const key = getConfig().googlePlacesApiKey;
  if (!key) return NextResponse.json({ photos: {} });
  if (ids.length === 0) return NextResponse.json({ photos: {} });

  const photos: Record<string, string[]> = {};

  // sequential with a small concurrency window keeps Google happy
  const queue = [...ids];
  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift()!;
      const cached = placeById(id);
      const have = cached?.photoRefs ?? [];
      if (have.length >= TARGET_PHOTOS) {
        photos[id] = have;
        continue;
      }
      const googleId = id.startsWith("g_") ? id.slice(2) : id;
      try {
        const refs = await googlePlacePhotos(key, googleId);
        const merged = [...new Set([...have, ...refs])].slice(0, 8);
        if (cached && merged.length > 0) {
          upsertPlace({ ...cached, photoRefs: merged, photoRef: merged[0] });
        }
        photos[id] = merged;
      } catch {
        photos[id] = have; // keep what we had
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  return NextResponse.json({ photos });
}
