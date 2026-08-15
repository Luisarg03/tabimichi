import { NextRequest, NextResponse } from "next/server";
import { existsSync, statSync } from "node:fs";
import { getConfig } from "@/lib/settings";
import { googlePhotoBytes } from "@/lib/places/google";
import { photoCachePath, readCachedPhoto, writeCachedPhoto, CACHE_TTL_MS } from "@/lib/photos";

export const runtime = "nodejs";

/**
 * Google Places photo proxy with on-disk cache.
 * The API key never reaches the client: we fetch the photo server-side
 * (counts against the $200 monthly credit), cache it under data/photos/,
 * and serve the cached file afterwards. One fetch per photo, then local.
 */
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref");
  const id = req.nextUrl.searchParams.get("id") ?? "photo";
  if (!ref) return NextResponse.json({ error: "ref required" }, { status: 400 });

  const cachePath = photoCachePath(id, ref);

  // serve from disk cache when fresh
  if (existsSync(cachePath)) {
    const age = Date.now() - statSync(cachePath).mtimeMs;
    if (age < CACHE_TTL_MS) {
      const buf = readCachedPhoto(cachePath);
      if (buf) {
        return new Response(new Uint8Array(buf), {
          headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
        });
      }
    }
  }

  const key = getConfig().googlePlacesApiKey;
  if (!key) return NextResponse.json({ error: "no key" }, { status: 503 });

  try {
    const buf = await googlePhotoBytes(key, ref);
    writeCachedPhoto(cachePath, buf);
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
