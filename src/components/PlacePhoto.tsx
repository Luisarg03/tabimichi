"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";

/**
 * Authenticated photo <img>.
 * A plain <img src="/api/photo…"> cannot send the session JWT, so the photo
 * proxy would fall back to the operator env key and BYOK users would never
 * see their own photos. This component fetches the bytes with the user's
 * Bearer token and renders them as a blob URL — the key/token never touches
 * the URL, browser history or server logs.
 *
 * Blob URLs are cached per photo ref (module-level) so swiping a gallery or
 * re-rendering a list costs one fetch, not one per <img>. Failures (e.g. a
 * misconfigured key) render `fallback` silently — no broken-image icon, no
 * console noise.
 */
const blobCache = new Map<string, string>(); // "ref|id" → blob URL
const CACHE_CAP = 64;

function photoUrl(photoRef: string, placeId: string): string {
  return `/api/photo?ref=${encodeURIComponent(photoRef)}&id=${encodeURIComponent(placeId)}`;
}

export default function PlacePhoto({
  photoRef,
  placeId,
  alt,
  className,
  fallback = null,
}: {
  photoRef: string;
  placeId: string;
  alt: string;
  className?: string;
  /** Rendered when the photo cannot be loaded (default: nothing). */
  fallback?: ReactNode;
}) {
  const { getToken } = useAuth();
  const cacheKey = `${photoRef}|${placeId}`;
  // URLs fetched this session; the module cache is also consulted on every
  // render, so a cache hit for a re-swiped ref shows up without a fetch.
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const src = urls[cacheKey] ?? blobCache.get(cacheKey) ?? null;

  useEffect(() => {
    if (blobCache.has(cacheKey) || failed) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          photoUrl(photoRef, placeId),
          token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
        );
        if (!res.ok) throw new Error(`photo-${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (blobCache.size >= CACHE_CAP) {
          const oldest = blobCache.keys().next().value;
          if (oldest !== undefined) {
            const oldUrl = blobCache.get(oldest);
            blobCache.delete(oldest);
            if (oldUrl) URL.revokeObjectURL(oldUrl);
          }
        }
        blobCache.set(cacheKey, url);
        setUrls((prev) => ({ ...prev, [cacheKey]: url }));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoRef, placeId, cacheKey, getToken, failed]);

  if (failed) return fallback;
  if (!src) return null; // loading
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={className} />;
}
