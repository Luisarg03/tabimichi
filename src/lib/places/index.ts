import type { Place } from "../types";
import { getConfig, type AppConfig } from "../settings";
import { cachePlaces, cachedNear, freshNearby, discoveryDone, markDiscoveryDone } from "../cache";
import { haversineKm } from "../geo";
import { resolveTypes } from "./taxonomy";
import { googleSearchAll } from "./google";
import { geoapifySearch } from "./geoapify";
import { overpassSearch, TOTAL_BUDGET_MS, SUPPLEMENTARY_BUDGET_MS } from "./overpass";

/**
 * Shared cache TTL: places rarely change, but the POOL must not stay frozen
 * for a whole day — a single discovery where one source failed (e.g. Overpass
 * mirrors down) would otherwise serve a partial area for 24 h. 6 h bounds the
 * stale window while keeping repeat searches instant.
 */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

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
 * Second dedupe pass for near-duplicates with *different* spellings: the same
 * POI arrives from several sources (Google, Geoapify, Overpass) with the same
 * name but slightly offset coordinates — Geoapify snaps to building centroids
 * while OSM reports the node, so the copies can sit 40–100 m apart. A
 * candidate is dropped only when it is really the same POI: the same
 * normalized name within ~100 m AND the same type. Two differently-named
 * places near each other are deliberately NOT dropped — in a dense street
 * that's two real local businesses, and dropping them silently removed
 * exactly the nearby options the user wants.
 */
const SAME_NAME_DUP_KM = 0.1;
const SOURCE_PRIORITY: Record<string, number> = { google: 0, geoapify: 1, overpass: 2 };

export function normalizePlaceName(name: string): string {
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
      if (haversineKm(k, p) > SAME_NAME_DUP_KM) return false;
      if (!p.tags.some((t) => k.tags.includes(t))) return false; // different type = different POI
      return normalizePlaceName(p.name) === normalizePlaceName(k.name); // same place, same name
    });
    if (!isDup) kept.push(p);
  }
  return kept;
}

/** The full merge pipeline: drop generic names, exact dupes, then near dupes. */
function mergePlaces(places: Place[]): Place[] {
  return proximityDedupe(dedupe(places.filter((p) => !isFallbackName(p.name))));
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

  // fast path: reuse a fresh local cache covering every requested type, or a
  // cached keyword pool. Keyword rows are stored with their keyword_key (see
  // migration 008) so a repeat search ("pokemon" in Tokyo, asked 13 times in
  // the logs) no longer re-runs Google Text Search: 4.9 s p50 → cache read.
  // SKIPPED with a keyword only when that keyword's pool was cached under a
  // different type set — the scoring layer ranks keyword hits by intent, so
  // the requested types do not constrain a keyword answer.
  const typeIds = experienceTypes.map((t) => t.id);
  const cached = await freshNearby(lat, lng, radiusKm, typeIds, CACHE_TTL_MS, keyword);
  // Cached keyword rows are authoritative even when the answer is empty: the
  // live query already ran and matched nothing. "miss" is not an answer —
  // that is an incomplete pool, a keyword never searched, or a dead store.
  const servable = cached.status === "found" || (cached.status === "empty" && keyword !== undefined);
  const cachedPlaces = cached.status === "found" ? cached.places : [];
  if (servable) {
    // only return places that match the requested types (and hide stale
    // generic-named rows, e.g. "Parque (way 123)" cached before the fix).
    // Re-run the merge pipeline: cached pools can hold pre-fix duplicates
    // (same POI cached once per source with offset coordinates).
    // Keyword rows are exempt: their pool came from the keyword query itself.
    const matched = keyword
      ? mergePlaces(cachedPlaces)
      : mergePlaces(cachedPlaces.filter((p) => p.tags.some((t) => typeIds.includes(t))));
    // A keyed user must NOT be served a pool that lacks Google data — e.g.
    // an area first cached by an anonymous search (OSM-only), or by a search
    // where Google failed. The whole point of the key is the rich merge
    // (ratings/photos/hours); re-discover to add it instead of freezing the
    // thin pool. Anonymous users happily reuse any pool.
    const hasGoogle = matched.some((p) => p.source === "google");
    if (matched.length > 0 && (!config.googlePlacesApiKey || hasGoogle)) {
      // NB: fetched_at is deliberately NOT refreshed here — a cache hit must
      // stay a single round trip. Consequence: open_now goes unknown after
      // OPEN_NOW_FRESH_MS (scoring drops the open/closed term, as documented).
      return {
        places: matched.slice(0, POOL_CAP),
        source: "cache",
        keywordResults: keyword ? matched.filter((p) => p.fromKeyword).length : undefined,
        sources: ["cache"],
      };
    }
    // Keyword answered nothing and a keyed pool would not be richer: report
    // the miss from cache instead of re-asking Google for the same zero.
    if (cached.status === "empty" && keyword !== undefined) {
      return { places: [], source: "cache", keywordResults: 0, sources: ["cache"] };
    }
  }

  // negative cache: this exact area+types (or keyword) was already answered
  // with nothing by a source that actually responded. Without this the retry
  // re-spends Overpass' whole 20 s budget to fail identically (measured: 24
  // requests at 20-84 s, all with 0 candidates).
  if (await discoveryDone(lat, lng, typeIds, keyword)) {
    return { places: [], source: "cache", keywordResults: keyword ? 0 : undefined, sources: ["cache"] };
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
  let bounded = mergePlaces([...googlePlaces, ...geoapifyPlaces, ...overpassPlaces]).filter(
    (p) => haversineKm({ lat, lng }, p) <= radiusKm * 1.5
  );

  // last resort: cached places near the point (type-filtered) when every live
  // source failed; skipped for keywords (a keyword pool is not a generic pool)
  let fromCache = false;
  if (bounded.length === 0 && !keyword) {
    const cached = await cachedNear(lat, lng, radiusKm * 2);
    const matched = mergePlaces(
      types.length > 0 ? cached.filter((p) => p.tags.some((t) => types.includes(t))) : cached
    );
    bounded = matched;
    fromCache = bounded.length > 0;
  }

  const pool = bounded.slice(0, POOL_CAP);
  if (pool.length > 0) await cachePlaces(pool, keyword);

  // Remember a conclusive empty answer so the retry does not re-spend the
  // whole source budget (measured: 24 requests at 20-84 s, all zero-candidate).
  //
  // Only Overpass may testify here. It is the source that actually costs the
  // budget, and it is the only one whose empty answer is distinguishable from
  // its own failure: overpassSearch rejects when every mirror is unreachable
  // and resolves [] only when a mirror really answered "no matches"
  // (overpass-empty). Google throws on a failed page, but geoapifySearch
  // resolves [] even when all of its per-type requests rejected, so a
  // fulfilled Google/Geoapify promise is NOT evidence that anyone answered —
  // gating on them would cache an outage as "nothing here".
  const emptyConclusion = runOverpass && ov.status === "fulfilled";
  if (pool.length === 0 && emptyConclusion) {
    await markDiscoveryDone(lat, lng, typeIds, keyword);
  }

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
