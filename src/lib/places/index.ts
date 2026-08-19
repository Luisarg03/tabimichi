import type { Place } from "../types";
import { getConfig, type AppConfig } from "../settings";
import { cachePlaces, cachedNear, freshNearby } from "../cache";
import { haversineKm } from "../geo";
import { resolveTypes } from "./taxonomy";
import { googleSearchAll } from "./google";
import { geoapifySearch } from "./geoapify";
import { overpassSearch, TOTAL_BUDGET_MS, SUPPLEMENTARY_BUDGET_MS } from "./overpass";

/** Shared cache TTL: places rarely change — discover each area once a day. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Hard cap on the merged pool that gets cached — the UI shows the scored
 *  top of it, the rest is kept for repeat visits. */
const POOL_CAP = 600;

export interface DiscoverOptions {
  lat: number;
  lng: number;
  radiusKm: number;
  types: string[]; // empty = any
  lang?: string;
  /** optional interest keyword: "pokemon", "book off", "gatos"… (already normalized) */
  keyword?: string;
  /** per-user API keys (BYOK) — empty for anonymous; endpoints are user-supplied */
  config?: AppConfig;
}

export type SourceNote = "google" | "geoapify" | "overpass" | "cache" | "none";
/** Sources that actually contributed (never "none"). */
export type ContributingSource = Exclude<SourceNote, "none">;

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
 * Second dedupe pass for near-duplicates with *different* spellings: OpenStreetMap
 * usually has the same place as Google a few meters away ("Ramen Ichiban" on both
 * sides). A candidate is dropped only when it is really the same POI — the same
 * normalized name within ~40 m. Two differently-named places near each other are
 * deliberately NOT dropped: in a dense street that's two real local businesses,
 * and dropping them silently removed exactly the nearby options the user wants.
 */
const PROX_DUP_KM = 0.04;
const SOURCE_PRIORITY: Record<string, number> = { google: 0, geoapify: 1, overpass: 2 };

function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, "");
}

/** Old Overpass fallback-name pattern ("Parque (node 123)", "Zona de compras
 *  (way 9)") — bare coordinates with a generic label. Overpass no longer emits
 *  these, but stale cache rows still carry them: hide them defensively. */
function isFallbackName(name: string): boolean {
  return /^.+\([a-z]+ \d+\)$/.test(name.trim());
}

function proximityDedupe(places: Place[]): Place[] {
  if (places.length < 2) return places;
  const sorted = [...places].sort(
    (a, b) => (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9)
  );
  const kept: Place[] = [];
  for (const p of sorted) {
    const isDup = kept.some((k) => {
      if (haversineKm(k, p) > PROX_DUP_KM) return false;
      if (!p.tags.some((t) => k.tags.includes(t))) return false; // different type = different POI
      return normName(p.name) === normName(k.name); // same place, same name
    });
    if (!isDup) kept.push(p);
  }
  return kept;
}

/**
 * Multi-source discovery, run in PARALLEL and MERGED (not first-wins):
 *   1. Google Places   — when a key is configured (rich: ratings, hours, photos)
 *   2. Geoapify        — when a free key is configured (curated OSM categories)
 *   3. OpenStreetMap Overpass — always (free; the "find every POI" engine,
 *      with per-type output caps so no single type starves the others;
 *      skipped only for keyword-intent searches with a Google key)
 * The first source that returns places used to win — that meant Overpass
 * (the only unbounded, popularity-unbiased engine) NEVER ran for keyed users.
 * Now every source contributes and the scoring layer ranks the merged pool by
 * mobility/weather/profile, so prominence bias stops limiting the options.
 *
 * Latency guard: Overpass gets a full 20 s budget only when it is the sole
 * source (anonymous); with keys it is a supplementary add-on capped at 12 s.
 * Keyword-intent searches skip Overpass when a Google key answered — the
 * keyword is the point, not generic OSM volume.
 */
export async function discover(
  opts: DiscoverOptions
): Promise<{ places: Place[]; source: SourceNote; keywordResults?: number; sources: ContributingSource[] }> {
  const { lat, lng, radiusKm, types, lang = "es", keyword, config: userConfig } = opts;
  const radiusM = Math.round(radiusKm * 1000);
  const experienceTypes = resolveTypes(types);
  const config = userConfig ?? getConfig();
  // how many candidates came from the keyword query itself (0 = keyword miss)
  const gstats: { keywordResults?: number } = {};

  const overpassEndpoint = config.overpassEndpoint?.trim() || undefined;

  // fast path: reuse a fresh local cache covering every requested type.
  // SKIPPED when an interest keyword is set — the cache is keyword-agnostic
  // and would bypass the keyword discovery entirely (Google must be asked).
  const typeIds = experienceTypes.map((t) => t.id);
  if (!keyword) {
    const fresh = await freshNearby(lat, lng, radiusKm, typeIds, CACHE_TTL_MS);
    if (fresh && fresh.length > 0) {
      // only return places that match the requested types (and hide stale
      // generic-named rows, e.g. "Parque (way 123)" cached before the fix)
      const matched = fresh.filter(
        (p) => !isFallbackName(p.name) && p.tags.some((t) => typeIds.includes(t))
      );
      if (matched.length > 0) return { places: matched, source: "cache", sources: ["cache"] };
    }
  }

  const hasKey = Boolean(config.googlePlacesApiKey || config.geoapifyApiKey);
  // Keyword + Google key = intent mode: the keyword query is the whole point,
  // generic OSM volume adds latency without intent value — skip Overpass.
  const runOverpass = !(keyword && Boolean(config.googlePlacesApiKey));

  const [g, geo, ov] = await Promise.allSettled([
    config.googlePlacesApiKey
      ? googleSearchAll(config.googlePlacesApiKey!, experienceTypes, lat, lng, radiusM, lang, keyword, gstats)
      : Promise.resolve([]),
    config.geoapifyApiKey
      ? geoapifySearch(config.geoapifyApiKey, experienceTypes, lat, lng, radiusM, lang)
      : Promise.resolve([]),
    runOverpass
      ? overpassSearch(experienceTypes, lat, lng, radiusM, {
          endpoint: overpassEndpoint,
          budgetMs: hasKey ? SUPPLEMENTARY_BUDGET_MS : TOTAL_BUDGET_MS,
        })
      : Promise.resolve([]),
  ]);

  const googlePlaces = g.status === "fulfilled" ? g.value : [];
  const geoapifyPlaces = geo.status === "fulfilled" ? geo.value : [];
  const overpassPlaces = ov.status === "fulfilled" ? ov.value : [];

  // merge: higher-priority sources first so proximity dedupe keeps the richer
  // record; generic-named rows (stale cache "Parque (way 123)") are hidden
  const all = [...googlePlaces, ...geoapifyPlaces, ...overpassPlaces].filter(
    (p) => !isFallbackName(p.name)
  );
  let bounded = proximityDedupe(dedupe(all)).filter(
    (p) => haversineKm({ lat, lng }, p) <= radiusKm * 1.5
  );

  // last resort: cached places near the point (type-filtered) when every live
  // source failed; also skipped for keywords (cache is keyword-agnostic)
  let fromCache = false;
  if (bounded.length === 0 && !keyword) {
    const cached = await cachedNear(lat, lng, radiusKm * 2);
    const matched = (types.length > 0 ? cached.filter((p) => p.tags.some((t) => types.includes(t))) : cached)
      .filter((p) => !isFallbackName(p.name));
    bounded = matched;
    fromCache = bounded.length > 0;
  }

  const pool = bounded.slice(0, POOL_CAP);
  if (pool.length > 0) await cachePlaces(pool);

  // sources in priority order (display), source = dominant contributor (stats)
  const sources: ContributingSource[] = fromCache
    ? ["cache"]
    : (["google", "geoapify", "overpass"] as const).filter((s) => pool.some((p) => p.source === s));
  let source: SourceNote = "none";
  if (fromCache) {
    source = "cache";
  } else if (pool.length > 0) {
    const byCount = new Map<string, number>();
    for (const p of pool) byCount.set(p.source, (byCount.get(p.source) ?? 0) + 1);
    source = [...byCount.entries()].sort((a, b) => b[1] - a[1])[0][0] as SourceNote;
  }

  // keywordResults = keyword-query candidates that survived the radius bound:
  // Google may return relevant places (e.g. Snoopy cafés 70 km away) that are
  // out of reach — the UI must not pretend they exist nearby
  const keywordResults = keyword ? bounded.filter((p) => p.fromKeyword).length : gstats.keywordResults;
  return { places: pool, source, keywordResults, sources };
}
