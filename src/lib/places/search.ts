import type { Place, SearchSuggestion, SuggestionKind } from "../types";
import { EXPERIENCE_TYPES } from "./taxonomy";
import { haversineKm } from "../geo";
import { searchCachedPlaces } from "../cache";
import { normalizePlaceName } from "./index";
import { googleAutocomplete, googleTypeToExperience, type GooglePrediction } from "./google";

/**
 * Unified place/address autocomplete (Google-Maps-style single search box).
 *
 * Sources, concurrent and best-effort:
 *   1. Google Autocomplete — when the requesting user has a key; Google's
 *      own ranked predictions lead the list (no coords — resolved on pick).
 *   2. Local pool — cached discovery rows (instant; rating/photos/tags).
 *   3. Photon — free OSM autocomplete (POIs + streets, osm_key/osm_value).
 *   4. Nominatim — free OSM geocoder (cities and full addresses).
 *
 * Any source failing or timing out degrades to the rest; the response is
 * never an error because one remote died. Results are deduped (same
 * normalized name within 150 m keeps the richer record) and ranked by
 * match tier (exact > prefix > word-prefix > contains), distance tier,
 * then rating. Serverless-only: no operator keys, no self-hosted services.
 */

export const SUGGEST_LIMIT_MAX = 10;
export const SUGGEST_LIMIT_DEFAULT = 8;

/** Per-source hard timeout — suggestions must stay fast enough for type-ahead. */
const REMOTE_TIMEOUT_MS = 4000;

const PHOTON_URL = "https://photon.komoot.io/api/";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/** Normalize for matching: NFKD decomposes width + precomposed Latin
 *  diacritics (é → e + ́, then the combining mark is stripped); the final
 *  NFKC recomposes what matters (e.g. voiced kana か+゙ → が). Kanji/kana are
 *  preserved as-is. */
export function normalizeQuery(q: string): string {
  return q
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** 0 exact · 1 name-prefix · 2 word-prefix · 3 contains · 4 otherwise. */
export function matchTier(name: string, nq: string): number {
  const n = normalizeQuery(name);
  if (n === nq) return 0;
  if (n.startsWith(nq)) return 1;
  if (n.split(" ").some((w) => w.startsWith(nq))) return 2;
  if (n.includes(nq)) return 3;
  return 4;
}

/** 0 ≤5 km · 1 ≤20 km · 2 ≤100 km / unknown · 3 farther. */
function distTier(km?: number): number {
  if (km === undefined) return 2;
  if (km <= 5) return 0;
  if (km <= 20) return 1;
  if (km <= 100) return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// OSM category → experience type (reuses the discovery taxonomy)
// ---------------------------------------------------------------------------

/** `key=value` (Overpass spec form) → experience type id. */
export const OSM_TAG_TO_TYPE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const t of EXPERIENCE_TYPES) {
    for (const spec of t.overpass) {
      if (!spec.value.startsWith("~")) map[`${spec.key}=${spec.value}`] = t.id;
    }
  }
  // Curated aliases beyond the discovery specs (categories people search
  // that are not part of the discovery pool).
  Object.assign(map, {
    "amenity=cafe": "food",
    "amenity=fast_food": "food",
    "amenity=ice_cream": "food",
    "amenity=bar": "nightlife",
    "amenity=pub": "nightlife",
    "amenity=nightclub": "nightlife",
    "amenity=cinema": "nightlife",
    "tourism=gallery": "museum",
    "tourism=zoo": "park",
    "tourism=theme_park": "park",
    "leisure=nature_reserve": "trekking",
    "leisure=garden": "park",
    "natural=beach": "park",
    "shop=department_store": "shopping",
    "shop=mall": "shopping",
    "historic=castle": "temple",
    "historic=memorial": "temple",
  });
  return map;
})();

export function osmTypeId(osmKey?: string, osmValue?: string): string | undefined {
  if (!osmKey || !osmValue) return undefined;
  return OSM_TAG_TO_TYPE[`${osmKey}=${osmValue}`];
}

// ---------------------------------------------------------------------------
// Source adapters
// ---------------------------------------------------------------------------

function toCachedSuggestion(p: Place, q: string, bias?: { lat: number; lng: number }): SearchSuggestion {
  return {
    id: `p_cache_${p.id}`,
    kind: "place",
    name: p.name,
    sublabel: p.address,
    lat: p.lat,
    lng: p.lng,
    typeId: p.tags[0],
    source: "cache",
    distanceKm: bias ? Math.round(haversineKm(bias, p) * 10) / 10 : undefined,
    rating: p.rating,
    userRatingsTotal: p.userRatingsTotal,
  };
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    name?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    district?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

/** Photon tags POIs with osm_key; `type` alone is not reliable (a temple or
 *  a station often has type "house"). */
const PHOTON_POI_KEYS = new Set([
  "amenity",
  "tourism",
  "shop",
  "leisure",
  "historic",
  "natural",
  "railway",
  "public_transport",
  "aerialway",
  "healthcare",
  "sport",
]);

async function photonSuggest(
  q: string,
  lang: string,
  limit: number,
  bias?: { lat: number; lng: number }
): Promise<SearchSuggestion[]> {
  const params = new URLSearchParams({
    q,
    limit: String(Math.min(limit * 2, 12)),
  });
  // Photon only supports default/de/en/fr — "es" gets HTTP 400. Omit lang for
  // non-English locales: the default already prefers localized OSM names.
  if (lang === "en") params.set("lang", "en");
  if (bias) {
    params.set("lat", bias.lat.toFixed(5));
    params.set("lon", bias.lng.toFixed(5));
  }
  const res = await fetch(`${PHOTON_URL}?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`photon-http-${res.status}`);
  const data = (await res.json()) as { features?: PhotonFeature[] };
  const out: SearchSuggestion[] = [];
  let rank = 0;
  for (const f of data.features ?? []) {
    const p = f.properties ?? {};
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (lng === undefined || lat === undefined || !p.name) continue;

    const pt = p.type ?? "";
    const osmKey = p.osm_key ?? "";
    let kind: SuggestionKind = "place";
    if (!PHOTON_POI_KEYS.has(osmKey) && ["city", "state", "country", "county", "locality"].includes(pt)) {
      kind = "city";
    } else if (!PHOTON_POI_KEYS.has(osmKey) && ["house", "street", "district"].includes(pt)) {
      kind = "address";
    }

    const locality = [p.district, p.city, p.state, p.country].filter(Boolean).join(", ");
    const sublabel =
      kind === "address"
        ? [p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ""}` : undefined, locality]
            .filter(Boolean)
            .join(", ")
        : kind === "city"
          ? [p.state, p.country].filter(Boolean).join(", ")
          : locality || undefined;

    out.push({
      id: p.osm_id ? `p_photon_${p.osm_id}` : `a_${lat.toFixed(4)}_${lng.toFixed(4)}`,
      kind,
      name: p.name,
      sublabel,
      lat,
      lng,
      typeId: kind === "place" ? osmTypeId(p.osm_key, p.osm_value) : undefined,
      source: "photon",
      distanceKm: bias ? Math.round(haversineKm(bias, { lat, lng }) * 10) / 10 : undefined,
      remoteRank: rank,
    });
    rank++;
  }
  return out;
}

interface NominatimResult {
  place_id?: number;
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  importance?: number;
}

const NOMINATIM_PLACE_CATEGORIES = new Set([
  "amenity",
  "tourism",
  "shop",
  "leisure",
  "historic",
  "natural",
  "building",
]);

/** Administrative regions resolve to the "city" bucket (regions/states too). */
const NOMINATIM_CITY_TYPES = new Set([
  "city",
  "town",
  "village",
  "municipality",
  "county",
  "state",
  "province",
  "country",
  "island",
  "administrative",
]);

async function nominatimSuggest(
  q: string,
  lang: string,
  limit: number,
  bias?: { lat: number; lng: number }
): Promise<SearchSuggestion[]> {
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: String(Math.min(limit * 2, 12)),
    "accept-language": lang === "en" ? "en" : "es",
  });
  if (bias) {
    // viewbox = minLon,maxLat,maxLon,minLat; bounded=0 → bias, not restriction
    params.set("viewbox", `${(bias.lng - 1).toFixed(4)},${(bias.lat + 1).toFixed(4)},${(bias.lng + 1).toFixed(4)},${(bias.lat - 1).toFixed(4)}`);
    params.set("bounded", "0");
  }
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { "User-Agent": "tabi-local/0.1 (personal travel discovery app)" },
    signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`nominatim-http-${res.status}`);
  const data = (await res.json()) as NominatimResult[];
  const out: SearchSuggestion[] = [];
  data.forEach((r, rank) => {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!r.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

    let kind: SuggestionKind;
    // Nominatim reports cities as category "place" OR as admin boundaries
    // (category "boundary", type "administrative") — both are destinations.
    if (r.category === "place" || r.category === "boundary") kind = "city";
    else if (r.category === "highway") kind = "address";
    else if (NOMINATIM_CITY_TYPES.has(r.type ?? "")) kind = "city";
    else if (NOMINATIM_PLACE_CATEGORIES.has(r.category ?? "")) kind = "place";
    else kind = "address";

    // display_name is long and locality-noisy — keep the first 3 segments
    const sublabel = (r.display_name ?? "").split(",").slice(0, 3).join(",").trim();

    out.push({
      id: r.place_id ? `p_nominatim_${r.place_id}` : `a_${lat.toFixed(4)}_${lng.toFixed(4)}`,
      kind,
      name: r.name,
      sublabel: sublabel || undefined,
      lat,
      lng,
      typeId: kind === "place" ? osmTypeId(r.category, r.type) : undefined,
      source: "nominatim",
      distanceKm: bias ? Math.round(haversineKm(bias, { lat, lng }) * 10) / 10 : undefined,
      remoteRank: rank,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Merge + rank
// ---------------------------------------------------------------------------

/** Dedupe: same normalized name within 150 m is the same place. Preference:
 *  1) a record with a rating (cache/Google enrichment) wins;
 *  2) otherwise the provider's better relevance (lower remoteRank) wins —
 *     e.g. the famous Zenkō-ji arrives as Nominatim rank 0 and Photon rank 7;
 *     the rank-7 copy must not shadow the rank-0 one. */
const SAME_PLACE_DUP_KM = 0.15;

function effectiveRank(s: SearchSuggestion): number {
  return s.remoteRank ?? 2; // cache rows have no provider rank → neutral
}

function recordPreference(s: SearchSuggestion): [number, number] {
  return [s.rating !== undefined ? 0 : 1, effectiveRank(s)];
}

function mergeSuggestions(items: SearchSuggestion[]): SearchSuggestion[] {
  const kept: SearchSuggestion[] = [];
  for (const s of items) {
    const idx = kept.findIndex(
      (k) =>
        k.lat !== undefined &&
        k.lng !== undefined &&
        s.lat !== undefined &&
        s.lng !== undefined &&
        haversineKm({ lat: k.lat, lng: k.lng }, { lat: s.lat, lng: s.lng }) <= SAME_PLACE_DUP_KM &&
        normalizePlaceName(k.name) === normalizePlaceName(s.name)
    );
    if (idx === -1) {
      kept.push(s);
    } else {
      const [pa, ra] = recordPreference(s);
      const [pb, rb] = recordPreference(kept[idx]);
      if (pa < pb || (pa === pb && ra < rb)) kept[idx] = s;
    }
  }
  return kept;
}

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff]/;

/**
 * Deterministic rank: match tier dominates; remote matches across scripts
 * (romaji query ↔ kanji name — the provider already did the transliteration
 * and matched semantically) count as prefix matches, not misses. Distance
 * tier, then provider relevance, then rating break the ties.
 */
export function rankSuggestions(
  items: SearchSuggestion[],
  q: string,
  limit: number
): SearchSuggestion[] {
  const nq = normalizeQuery(q);
  const scored = items.map((s) => {
    const tier = matchTier(s.name, nq);
    const crossScript =
      tier === 4 && s.source !== "cache" && CJK_RE.test(s.name) !== CJK_RE.test(nq);
    const effTier = crossScript ? 1 : tier;
    return {
      s,
      key: effTier * 10 + distTier(s.distanceKm) * 3 + (s.kind === "address" ? 1 : 0),
    };
  });
  scored.sort(
    (a, b) =>
      a.key - b.key ||
      effectiveRank(a.s) - effectiveRank(b.s) ||
      (b.s.rating ?? -1) - (a.s.rating ?? -1) ||
      (a.s.distanceKm ?? 999) - (b.s.distanceKm ?? 999)
  );
  return scored.slice(0, limit).map((x) => x.s);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface SearchPlacesOptions {
  q: string;
  lang?: string;
  /** bias point (current destination) for distance-aware ranking */
  lat?: number;
  lng?: number;
  limit?: number;
  /** requesting user's Google key (BYOK) — enables Autocomplete predictions */
  googleKey?: string;
}

export interface SearchPlacesResult {
  suggestions: SearchSuggestion[];
  /** sources that actually contributed (telemetry) */
  sources: Array<"google" | "cache" | "photon" | "nominatim">;
}

/** Google prediction → suggestion: name = text before the first comma,
 *  typeId from Google's own types, no coordinates (resolved on pick). */
function toGoogleSuggestion(p: GooglePrediction, rank: number): SearchSuggestion {
  const name = p.description.split(",")[0].trim();
  const rest = p.description.split(",").slice(1).join(",").trim();
  return {
    id: `g_pred_${p.place_id}`,
    kind: "place",
    name,
    sublabel: rest || undefined,
    placeId: p.place_id,
    typeId: googleTypeToExperience(p.types),
    source: "google",
    remoteRank: rank,
  };
}

export async function searchPlaces(opts: SearchPlacesOptions): Promise<SearchPlacesResult> {
  const q = normalizeQuery(opts.q);
  const limit = Math.max(1, Math.min(opts.limit ?? SUGGEST_LIMIT_DEFAULT, SUGGEST_LIMIT_MAX));
  const lang = opts.lang === "en" ? "en" : "es";
  const bias =
    opts.lat !== undefined && opts.lng !== undefined && Number.isFinite(opts.lat) && Number.isFinite(opts.lng)
      ? { lat: opts.lat, lng: opts.lng }
      : undefined;

  const [local, photon, nominatim, google] = await Promise.allSettled([
    searchCachedPlaces(q, limit).then((ps) => ps.map((p) => toCachedSuggestion(p, q, bias))),
    photonSuggest(q, lang, limit, bias),
    nominatimSuggest(q, lang, limit, bias),
    opts.googleKey
      ? googleAutocomplete(opts.googleKey, q, lang, bias?.lat, bias?.lng)
      : Promise.resolve([] as GooglePrediction[]),
  ]);

  const bySource: Array<[SearchSuggestion[], "cache" | "photon" | "nominatim"]> = [
    [local.status === "fulfilled" ? local.value : [], "cache"],
    [photon.status === "fulfilled" ? photon.value : [], "photon"],
    [nominatim.status === "fulfilled" ? nominatim.value : [], "nominatim"],
  ];

  // Google predictions lead in Google's own relevance order (GMaps feel);
  // merged items that duplicate a prediction by name are dropped so the
  // same place never appears twice.
  const googleSuggestions =
    google.status === "fulfilled" ? google.value.map(toGoogleSuggestion) : [];
  const gNames = new Set(googleSuggestions.map((s) => normalizePlaceName(s.name)));
  const merged = mergeSuggestions(bySource.flatMap(([items]) => items)).filter(
    (s) => !gNames.has(normalizePlaceName(s.name))
  );

  return {
    suggestions: [...googleSuggestions, ...rankSuggestions(merged, q, limit)].slice(0, limit),
    sources: [
      ...(googleSuggestions.length > 0 ? (["google"] as const) : []),
      ...bySource.filter(([items]) => items.length > 0).map(([, s]) => s),
    ],
  };
}
