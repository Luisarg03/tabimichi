"use client";

import { useEffect, useState } from "react";

/**
 * Free hero photo for keyless users: OSM `wikipedia` tags (`ja:渋温泉`)
 * resolve to a real thumbnail via the Wikipedia PageImages API — no key,
 * CORS-open (`origin=*`), hotlinkable `upload.wikimedia.org` bytes.
 * Bare Wikidata Q-ids are skipped (need a second resolution hop).
 * Returns null while loading or when unresolvable: the caller falls back
 * to the per-type illustration.
 */

/** `ja:渋温泉` → {lang, title}; Q-ids and garbage → null. */
export function parseWikiRef(ref: string): { lang: string; title: string } | null {
  const m = /^([a-z-]{2,12}):(.+)$/i.exec(ref.trim());
  if (!m || /^q\d+$/i.test(m[2])) return null;
  return { lang: m[1].toLowerCase(), title: m[2].replace(/_/g, " ") };
}

export default function WikiPhoto({
  wikiRef,
  alt,
  className = "h-52 w-full object-cover sm:h-60",
}: {
  wikiRef: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  // unparseable refs die without an effect round-trip (no setState-in-effect)
  const [dead, setDead] = useState(() => parseWikiRef(wikiRef) == null);

  useEffect(() => {
    const parsed = parseWikiRef(wikiRef);
    if (!parsed) return;
    let cancelled = false;
    (async () => {
      try {
        const url =
          `https://${parsed.lang}.wikipedia.org/w/api.php` +
          `?action=query&prop=pageimages&format=json&pithumbsize=800&origin=*` +
          `&titles=${encodeURIComponent(parsed.title)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`wiki-${res.status}`);
        const data = (await res.json()) as {
          query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
        };
        const thumb = Object.values(data.query?.pages ?? {})[0]?.thumbnail?.source;
        if (!thumb) throw new Error("wiki-noimage");
        if (!cancelled) setSrc(thumb);
      } catch {
        if (!cancelled) setDead(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wikiRef]);

  if (dead || !src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={className} />;
}
