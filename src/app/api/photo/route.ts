import { NextRequest, NextResponse } from "next/server";
import { googlePhotoBytes } from "@/lib/places/google";
import { readCachedPhoto, writeCachedPhoto } from "@/lib/cache";
import { enforceRateLimit } from "@/lib/security";
import { getUserKeys } from "@/lib/user-keys";

export const runtime = "nodejs";

/** 1×1 transparent GIF — served whenever a photo is unavailable (no key,
 *  broken key, expired ref). Photo proxying is best-effort: a missing image
 *  must never be an HTTP error (broken-image icons, console noise). */
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function gifResponse(): Response {
  return new Response(new Uint8Array(TRANSPARENT_GIF), {
    headers: { "Content-Type": "image/gif", "Cache-Control": "public, max-age=86400" },
  });
}

function jpegResponse(buf: Buffer): Response {
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
}

/**
 * Google Places photo proxy with a shared Supabase Storage cache.
 * BYOK: with a session, the requesting user's own Google key is used (they
 * control what they spend); anonymous requests are keyless (placeholder).
 * Each photo is downloaded once (whoever fetches it first) and served from
 * the shared cache afterwards — no per-user re-fetch, no quota burn.
 */
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref");
  const id = req.nextUrl.searchParams.get("id") ?? "photo";
  if (!ref) return NextResponse.json({ error: "ref required" }, { status: 400 });

  // Image loads can be frequent (gallery thumbnails); bound proxy abuse.
  const limited = enforceRateLimit(req, "photo", { perIp: 120 });
  if (limited) return limited;

  const cached = await readCachedPhoto(id, ref);
  if (cached) return jpegResponse(cached);

  const config = await getUserKeys(req);
  const key = config.googlePlacesApiKey;
  if (!key) {
    // No key (anonymous) → transparent placeholder. Nothing is cached —
    // a later keyed session proxies for real.
    return gifResponse();
  }

  try {
    const buf = await googlePhotoBytes(key, ref);
    await writeCachedPhoto(id, ref, buf);
    return jpegResponse(buf);
  } catch {
    // Broken key / expired photo ref → graceful placeholder, never an error.
    return gifResponse();
  }
}
