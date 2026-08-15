import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/settings";

export const runtime = "nodejs";

const PHOTO_DIR = path.join(process.cwd(), "data", "photos");
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Google Places photo proxy with on-disk cache.
 * The API key never reaches the client: we fetch the photo server-side
 * (counts against the $200 monthly credit), cache it under data/photos/,
 * and serve the cached file afterwards. One fetch per place, then local.
 */
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref");
  const id = req.nextUrl.searchParams.get("id") ?? "photo";
  if (!ref) return NextResponse.json({ error: "ref required" }, { status: 400 });

  // safe cache filename from the place id + a short ref fragment so each
  // photo of a place gets its own cached file
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const refPart = ref.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  const cachePath = path.join(PHOTO_DIR, `${safeId}__${refPart}.jpg`);

  // serve from disk cache when fresh
  if (existsSync(cachePath)) {
    const stat = (await import("node:fs/promises")).stat(cachePath);
    const age = Date.now() - (await stat).mtimeMs;
    if (age < CACHE_TTL_MS) {
      return new Response(readFileSync(cachePath), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
      });
    }
  }

  const key = getConfig().googlePlacesApiKey;
  if (!key) return NextResponse.json({ error: "no key" }, { status: 503 });

  try {
    const url =
      "https://maps.googleapis.com/maps/api/place/photo?" +
      new URLSearchParams({ maxwidth: "600", photo_reference: ref, key });
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return NextResponse.json({ error: `photo-${res.status}` }, { status: 502 });
    const buf = Buffer.from(await res.arrayBuffer());

    // cache on disk for next time
    try {
      mkdirSync(PHOTO_DIR, { recursive: true });
      writeFileSync(cachePath, buf);
    } catch {
      // cache failure is not fatal
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    return new Response(buf, {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
