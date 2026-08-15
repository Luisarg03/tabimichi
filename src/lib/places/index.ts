import type { Place } from "../types";
import { getConfig } from "../settings";
import { cachePlaces, cachedNear } from "../db";
import { resolveTypes, type ExperienceType } from "./taxonomy";
import { googleSearch } from "./google";
import { overpassSearch } from "./overpass";

export interface DiscoverOptions {
  lat: number;
  lng: number;
  radiusKm: number;
  types: string[]; // empty = any
  lang?: string;
}

export type SourceNote = "google" | "overpass" | "cache" | "none";

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
 * Discovery orchestrator: Google Places when a key is configured,
 * otherwise OpenStreetMap Overpass (best-effort, mirror failover).
 * Results are cached in SQLite. If live discovery fails entirely,
 * falls back to the local cache (type-filtered).
 */
export async function discover(opts: DiscoverOptions): Promise<{ places: Place[]; source: SourceNote }> {
  const { lat, lng, radiusKm, types, lang = "es" } = opts;
  const radiusM = Math.round(radiusKm * 1000);
  const experienceTypes = resolveTypes(types);
  const config = getConfig();
  let places: Place[] = [];
  let source: SourceNote = "none";

  if (config.googlePlacesApiKey) {
    try {
      const results = await Promise.allSettled(
        experienceTypes.map((t: ExperienceType) =>
          googleSearch(config.googlePlacesApiKey!, t, lat, lng, radiusM, lang)
        )
      );
      places = results
        .filter((r) => r.status === "fulfilled")
        .flatMap((r) => (r as PromiseFulfilledResult<Place[]>).value);
      if (places.length > 0) source = "google";
    } catch {
      // fall through to overpass
    }
  }

  if (places.length === 0) {
    try {
      // single combined query (mirror failover inside)
      places = await overpassSearch(experienceTypes, lat, lng, radiusM);
      if (places.length > 0) source = "overpass";
    } catch {
      // fall through to cache
    }
  }

  if (places.length === 0) {
    const cached = cachedNear(lat, lng, radiusKm * 2);
    places = types.length > 0 ? cached.filter((p) => p.tags.some((t) => types.includes(t))) : cached;
    if (places.length > 0) source = "cache";
  }

  const deduped = dedupe(places);
  if (deduped.length > 0) cachePlaces(deduped);
  return { places: deduped, source };
}
