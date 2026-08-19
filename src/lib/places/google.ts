import type { Place } from "../types";
import type { ExperienceType } from "./taxonomy";
import type { OpenPeriod } from "../open-hours";

interface GoogleResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  vicinity?: string;
  geometry: { location: { lat: number; lng: number } };
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  business_status?: string;
  opening_hours?: { open_now?: boolean };
  photos?: Array<{ photo_reference: string }>;
  types?: string[];
  url?: string;
}

interface GoogleResponse {
  status: string;
  results: GoogleResult[];
  next_page_token?: string;
  error_message?: string;
}

async function fetchResults(url: string): Promise<GoogleResponse> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`google-http-${res.status}`);
  return (await res.json()) as GoogleResponse;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch up to `maxPages` result pages (next_page_token pagination).
 * The first page is strict — errors surface. Later pages are best-effort:
 * a transient failure or a not-yet-valid token (INVALID_REQUEST) stops
 * pagination but keeps the results collected so far.
 */
async function fetchPages(
  buildUrl: (token?: string) => string,
  maxPages: number
): Promise<GoogleResult[]> {
  const out: GoogleResult[] = [];
  let token: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    let data: GoogleResponse;
    try {
      data = await fetchResults(buildUrl(token));
    } catch (e) {
      if (page === 0 && String((e as Error)?.message ?? "").includes("OVER_QUERY_LIMIT")) {
        // burst of parallel calls can trip the QPS cap — breathe and retry once
        await sleep(1200);
        try {
          data = await fetchResults(buildUrl(token));
        } catch (e2) {
          if (page === 0) throw e2;
          break;
        }
      } else if (page === 0) {
        throw e;
      } else {
        break;
      }
    }
    if (data.status === "INVALID_REQUEST" && token) {
      // next_page_token is not usable immediately — retry once after a pause
      await sleep(1200);
      try {
        data = await fetchResults(buildUrl(token));
      } catch {
        break;
      }
    }
    if (data.status === "ZERO_RESULTS") break;
    if (data.status !== "OK") {
      if (page === 0) throw new Error(`google-status-${data.status}`);
      break;
    }
    out.push(...data.results);
    token = data.next_page_token;
    if (!token) break;
    await sleep(250); // token needs a moment before the next page
  }
  return out;
}

/**
 * Google Places Text Search — query-driven; strictbounds keeps results in radius.
 * Types without a nearby category (e.g. temple) get 2 pages; the rest get 1
 * page (it is the semantic net — Nearby Search provides the density).
 *
 * NOTE: never send `language` here — the query terms are English and Google
 * matches text-search results against content indexed in that language:
 * `language=es` returns 1 result where the default returns 20.
 */
async function textSearch(
  apiKey: string,
  type: ExperienceType,
  lat: number,
  lng: number,
  radiusM: number,
  keyword?: string,
  stats?: { keywordResults?: number }
): Promise<GoogleResult[]> {
  const buildUrl = (token?: string) => {
    const params = new URLSearchParams({
      // with an interest keyword the query becomes the keyword itself
      // (e.g. "pokemon near …") — that's the whole point of keyword mode
      query: `${keyword ? keyword : type.googleQuery} near ${lat.toFixed(4)},${lng.toFixed(4)}`,
      location: `${lat.toFixed(5)},${lng.toFixed(5)}`,
      radius: String(Math.min(radiusM, 50000)),
      // restriction, not a bias: drop results outside the radius
      strictbounds: "true",
      key: apiKey,
    });
    if (token) params.set("pagetoken", token);
    return `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`;
  };
  return fetchPages(buildUrl, type.googleTypes?.length ? 1 : 2).then((rs) => {
    // results that came from the keyword query itself — 0 means the keyword
    // found nothing and the pool is generic (a "keyword miss")
    if (keyword && stats) stats.keywordResults = (stats.keywordResults ?? 0) + rs.length;
    return rs;
  });
}

/**
 * Google Places Nearby Search — category-driven, strictly radius-bounded, denser.
 * Paginated (up to 3 pages ≈ 60 results): in dense cities 20 results are a
 * prominence-biased sample that misses the best local places.
 *
 * NOTE: we never send `opennow=true`. That parameter also excludes every place
 * without opening-hours data (most parks, shrines, viewpoints) and everything
 * closed at the current instant — at 8am in Tokyo that's almost all of them,
 * leaving a tiny biased pool. Instead we keep all candidates and let the
 * scoring layer filter known-closed places and boost known-open ones.
 */
async function nearbySearch(
  apiKey: string,
  type: ExperienceType,
  lat: number,
  lng: number,
  radiusM: number,
  lang: string,
  gtypeOverride?: string
): Promise<GoogleResult[]> {
  const gtype = gtypeOverride ?? type.googleTypes?.[0];
  if (!gtype) return [];
  const buildUrl = (token?: string) => {
    const params = new URLSearchParams({
      location: `${lat.toFixed(5)},${lng.toFixed(5)}`,
      radius: String(Math.min(radiusM, 50000)),
      type: gtype,
      language: lang === "es" ? "es" : "en",
      key: apiKey,
    });
    if (token) params.set("pagetoken", token);
    return `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`;
  };
  return fetchPages(buildUrl, 3);
}

function toPlace(r: GoogleResult, type: ExperienceType, fromKeyword = false): Place {
  const photoRefs = (r.photos ?? []).slice(0, 5).map((p) => p.photo_reference);
  return {
    id: `g_${r.place_id}`,
    source: "google" as const,
    name: r.name,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    tags: [type.id],
    rating: r.rating,
    userRatingsTotal: r.user_ratings_total,
    priceLevel: r.price_level,
    openNow: r.opening_hours?.open_now ?? null,
    address: r.formatted_address ?? r.vicinity,
    photoRef: photoRefs[0],
    photoRefs,
    url: r.url,
    fromKeyword,
  };
}

/**
 * Hotels (Google type "lodging") pollute text-search results — a hotel with a
 * bakery inside matches "restaurant". They are noise for every experience type
 * except onsen, where ryokan-hotels with baths are exactly what we want.
 */
function isNoiseForType(r: GoogleResult, type: ExperienceType): boolean {
  return type.id !== "onsen" && (r.types ?? []).includes("lodging");
}

/**
 * Google Places discovery for one experience type:
 * text search + nearby search (when the type maps to a category), merged & deduped.
 */
export async function googleSearch(
  apiKey: string,
  type: ExperienceType,
  lat: number,
  lng: number,
  radiusM: number,
  lang: string,
  keyword?: string,
  stats?: { keywordResults?: number }
): Promise<Place[]> {
  if (!apiKey) throw new Error("no-google-key");

  const jobs: Array<{
    fromKeyword: boolean;
    promise: Promise<GoogleResult[]>;
  }> = [{ fromKeyword: Boolean(keyword), promise: textSearch(apiKey, type, lat, lng, radiusM, keyword, stats) }];
  // Nearby Search for EVERY mapped category, not just the first: in dense
  // cities a single category is a prominence-biased sample, and types like
  // food (restaurant + food) or shopping (3 categories) double/triple the pool.
  for (const gtype of type.googleTypes ?? []) {
    jobs.push({ fromKeyword: false, promise: nearbySearch(apiKey, type, lat, lng, radiusM, lang, gtype) });
  }
  if (keyword && type.id === "food") {
    jobs.push({ fromKeyword: false, promise: nearbySearch(apiKey, type, lat, lng, radiusM, lang, "cafe") });
  }

  const settled = await Promise.allSettled(jobs.map((j) => j.promise));
  const seen = new Set<string>();
  const out: Place[] = [];
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    // Google returns text results relevance-ordered: with a keyword, its
    // TOP-10 matches are kept — the user wants options, and lower-ranked
    // hits (e.g. a convenience store Google loosely matched for "snoopy")
    // still join the pool where scoring can rank them honestly.
    const kwRank = jobs[i].fromKeyword ? 10 : Infinity;
    for (const [idx, gr] of r.value.entries()) {
      if (gr.business_status && gr.business_status !== "OPERATIONAL") continue;
      if (isNoiseForType(gr, type)) continue;
      if (jobs[i].fromKeyword && idx >= kwRank) continue;
      if (seen.has(gr.place_id)) continue;
      seen.add(gr.place_id);
      out.push(toPlace(gr, type, jobs[i].fromKeyword && idx < kwRank));
    }
  });
  return out;
}

/**
 * Run the per-type Google searches with limited concurrency: a burst of
 * parallel calls trips the Places QPS cap and whole types silently vanish.
 */
export async function googleSearchAll(
  apiKey: string,
  types: ExperienceType[],
  lat: number,
  lng: number,
  radiusM: number,
  lang: string,
  keyword?: string,
  stats?: { keywordResults?: number }
): Promise<Place[]> {
  const limit = 3;
  let cursor = 0;
  const run = async (): Promise<Place[]> => {
    const out: Place[] = [];
    while (cursor < types.length) {
      const type = types[cursor++];
      try {
        out.push(...(await googleSearch(apiKey, type, lat, lng, radiusM, lang, keyword, stats)));
      } catch {
        // one type failing must not kill the others
      }
      await sleep(150); // gentle pacing between type bursts
    }
    return out;
  };
  const results = await Promise.all(
    Array.from({ length: Math.min(limit, types.length) }, () => run())
  );
  return results.flat();
}

interface DetailsResponse {
  status?: string;
  result?: {
    photos?: Array<{ photo_reference: string }>;
    opening_hours?: { periods?: OpenPeriod[] };
  };
}

/** Google photo bytes (follows the CDN redirect). Shared by proxy + enrichment. */
export async function googlePhotoBytes(
  apiKey: string,
  ref: string,
  maxwidth = 600
): Promise<Buffer> {
  const url =
    "https://maps.googleapis.com/maps/api/place/photo?" +
    new URLSearchParams({ maxwidth: String(maxwidth), photo_reference: ref, key: apiKey });
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`photo-http-${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Place Details: photos + structured opening periods in one call.
 * Used by the photo enrichment phase and by time-simulation mode.
 */
export async function googlePlaceDetails(
  apiKey: string,
  placeId: string
): Promise<{ photos: string[]; periods?: OpenPeriod[] }> {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: "photos,opening_hours",
    key: apiKey,
  });
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?${params}`,
    { signal: AbortSignal.timeout(20000) }
  );
  if (!res.ok) throw new Error(`details-http-${res.status}`);
  const data = (await res.json()) as DetailsResponse;
  if (data.status !== "OK" || !data.result) throw new Error(`details-status-${data.status}`);
  return {
    photos: (data.result.photos ?? []).slice(0, 8).map((p) => p.photo_reference),
    periods: data.result.opening_hours?.periods,
  };
}
