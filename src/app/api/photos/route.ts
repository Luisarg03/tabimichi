import { NextRequest, NextResponse } from "next/server";
import { placeById, upsertPlace, photosVerified, setPhotosVerified, photoHashesFor, rememberPhotoHash } from "@/lib/db";
import { googlePlaceDetails, googlePhotoBytes } from "@/lib/places/google";
import { getConfig } from "@/lib/settings";
import { photoCachePath, readCachedPhoto, writeCachedPhoto, sha1Hex } from "@/lib/photos";

export const runtime = "nodejs";

const MAX_ENRICH = 6;
const MAX_UNIQUE_PHOTOS = 6;

/**
 * Async photo enrichment with content-hash dedupe.
 * Google's search APIs return ~1 photo and Place Details up to 8, but
 * different photo_references can point to the SAME image (Google quirk).
 * We download each candidate once (reusing the proxy disk cache), hash it,
 * and keep only unique images — persisted in the DB so it never repeats.
 */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_ENRICH);

  const key = getConfig().googlePlacesApiKey;
  const photos: Record<string, string[]> = {};
  if (!key) return NextResponse.json({ photos });
  if (ids.length === 0) return NextResponse.json({ photos });

  const queue = [...ids];

  async function verifyPlace(id: string): Promise<string[]> {
    // already deduped before → serve stored refs
    if (photosVerified(id)) {
      const cached = placeById(id);
      return cached?.photoRefs ?? [];
    }

    const cached = placeById(id);
    const have = cached?.photoRefs ?? [];
    const refs = [...have];

    // pull more refs from Place Details
    const googleId = id.startsWith("g_") ? id.slice(2) : id;
    try {
      const details = await googlePlaceDetails(key, googleId);
      for (const r of details.photos) if (!refs.includes(r)) refs.push(r);
    } catch {
      // keep search refs
    }

    // hash-dedupe: reuse disk cache when available, else download once
    const seen = new Set<string>(photoHashesFor(id));
    const kept: string[] = [];
    for (const ref of refs) {
      if (kept.length >= MAX_UNIQUE_PHOTOS) break;
      try {
        const cachePath = photoCachePath(id, ref);
        let bytes = readCachedPhoto(cachePath);
        if (!bytes) {
          bytes = await googlePhotoBytes(key, ref);
          writeCachedPhoto(cachePath, bytes);
        }
        const hash = sha1Hex(bytes);
        if (seen.has(hash)) continue; // duplicate image (same photo, other ref)
        seen.add(hash);
        rememberPhotoHash(id, ref, hash);
        kept.push(ref);
      } catch {
        kept.push(ref); // unverifiable — keep it anyway
      }
    }

    if (cached && kept.length > 0) {
      upsertPlace({ ...cached, photoRefs: kept, photoRef: kept[0] });
    }
    setPhotosVerified(id, true);
    return kept;
  }

  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift()!;
      try {
        photos[id] = await verifyPlace(id);
      } catch {
        photos[id] = [];
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  return NextResponse.json({ photos });
}
