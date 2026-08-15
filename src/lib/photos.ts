import { createHash } from "node:crypto";
import path from "node:path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";

/** On-disk photo cache shared by the proxy and the enrichment phase. */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
let photoDir = path.join(process.cwd(), "data", "photos");

/** Testability: point the photo cache elsewhere. */
export function setPhotoDir(dir: string): void {
  photoDir = dir;
}

export function photoCachePath(id: string, ref: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const refPart = ref.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  return path.join(photoDir, `${safeId}__${refPart}.jpg`);
}

export function readCachedPhoto(p: string): Buffer | null {
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p);
  } catch {
    return null;
  }
}

export function writeCachedPhoto(p: string, buf: Buffer): void {
  try {
    mkdirSync(photoDir, { recursive: true });
    writeFileSync(p, buf);
  } catch {
    // cache failure is not fatal
  }
}

export function sha1Hex(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex");
}
