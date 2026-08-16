import type { Place } from "../types";
import { getConfig } from "../settings";
import { cachePlaces, cachedNear, freshNearby } from "../db";
import { haversineKm } from "../geo";
import { resolveTypes } from "./taxonomy";
import { googleSearchAll } from "./google";
import { geoapifySearch } from "./geoapify";
import { overpassSearch, setOverpassEndpoint } from "./overpass";

export interface DiscoverOptions {
  lat: number;
  lng: number;
  radiusKm: number;
  types: string[]; // empty = any
  lang?: string;
  /** optional interest keyword: "pokemon", "book off", "gatos"… (already normalized) */
  keyword?: string;
}

export type SourceNote = "google" | "geoapify" | "overpass" | "cache" | "none";

function dedupe(places: Place[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const p of places) {
    const key = `${p.name.trim().toLowerCase()}|${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Multi-source discovery orchestrator, tried in priority order:
 *   1. Google Places          — when a key is configured (rich: ratings, hours, photos)
 *   2. Geoapify               — when a free key is configured (curated OSM categories)
 *   3. OpenStreetMap Overpass — custom osm3s endpoint if set, else public mirrors
 *   4. local SQLite cache     — last resort (type-filtered)
 * The first source that returns places wins. Results are cached.
 */
export async function discover(
  opts: DiscoverOptions
): Promise<{ places: Place[]; source: SourceNote; keywordResults?: number }> {
  const { lat, lng, radiusKm, types, lang = "es", keyword } = opts;
  const radiusM = Math.round(radiusKm * 1000);
  const experienceTypes = resolveTypes(types);
  const config = getConfig();
  let places: Place[] = [];
  let source: SourceNote = "none";
  // how many candidates came from the keyword query itself (0 = keyword miss)
  const gstats: { keywordResults?: number } = {};

  if (config.overpassEndpoint) setOverpassEndpoint(config.overpassEndpoint);

  // fast path: reuse a fresh local cache covering every requested type.
  // SKIPPED when an interest keyword is set — the cache is keyword-agnostic
  // and would bypass the keyword discovery entirely (Google must be asked).
  const typeIds = experienceTypes.map((t) => t.id);
  if (!keyword) {
    const fresh = freshNearby(lat, lng, radiusKm, typeIds, 15 * 60 * 1000);
    if (fresh && fresh.length > 0) {
      // only return places that match the requested types
      const matched = fresh.filter((p) => p.tags.some((t) => typeIds.includes(t)));
      if (matched.length > 0) return { places: matched, source: "cache" };
    }
  }

  if (config.googlePlacesApiKey) {
    try {
      // concurrency-limited so the burst never trips Google's QPS cap
      places = await googleSearchAll(
        config.googlePlacesApiKey!,
        experienceTypes,
        lat,
        lng,
        radiusM,
        lang,
        keyword,
        gstats
      );
      if (places.length > 0) source = "google";
    } catch {
      // fall through
    }
  }

  if (places.length === 0 && config.geoapifyApiKey) {
    try {
      places = await geoapifySearch(config.geoapifyApiKey, experienceTypes, lat, lng, radiusM, lang);
      if (places.length > 0) source = "geoapify";
    } catch {
      // fall through
    }
  }

  if (places.length === 0) {
    try {
      // single combined query (custom endpoint first, then mirror failover)
      places = await overpassSearch(experienceTypes, lat, lng, radiusM);
      if (places.length > 0) source = "overpass";
    } catch {
      // fall through to cache
    }
  }

  if (places.length === 0 && !keyword) {
    // last-resort fallback; also skipped for keywords (cache is keyword-agnostic)
    const cached = cachedNear(lat, lng, radiusKm * 2);
    places = types.length > 0 ? cached.filter((p) => p.tags.some((t) => types.includes(t))) : cached;
    if (places.length > 0) source = "cache";
  }

  const deduped = dedupe(places);
  // Google Text Search can leak world-famous places outside the radius even
  // with strictbounds — hard-drop anything beyond 1.5× the discovery radius
  // so global results never become candidates (or pollute the cache)
  const bounded = deduped.filter((p) => haversineKm({ lat, lng }, p) <= radiusKm * 1.5);
  if (bounded.length > 0) cachePlaces(bounded);
  // keywordResults = keyword-query candidates that survived the radius bound:
  // Google may return relevant places (e.g. Snoopy cafés 70 km away) that are
  // out of reach — the UI must not pretend they exist nearby
  const keywordResults = keyword ? bounded.filter((p) => p.fromKeyword).length : gstats.keywordResults;
  return { places: bounded, source, keywordResults };
}
