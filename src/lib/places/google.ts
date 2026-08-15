import type { Place } from "../types";
import type { ExperienceType } from "./taxonomy";

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
  url?: string;
}

interface GoogleResponse {
  status: string;
  results: GoogleResult[];
  error_message?: string;
}

async function fetchResults(url: string): Promise<GoogleResult[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`google-http-${res.status}`);
  const data = (await res.json()) as GoogleResponse;
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`google-status-${data.status}`);
  }
  return data.results;
}

/** Google Places Text Search — query-driven; strictbounds keeps results in radius. */
async function textSearch(
  apiKey: string,
  type: ExperienceType,
  lat: number,
  lng: number,
  radiusM: number,
  lang: string
): Promise<GoogleResult[]> {
  const params = new URLSearchParams({
    query: `${type.googleQuery} near ${lat.toFixed(4)},${lng.toFixed(4)}`,
    location: `${lat.toFixed(5)},${lng.toFixed(5)}`,
    radius: String(Math.min(radiusM, 50000)),
    // restriction, not a bias: drop results outside the radius
    strictbounds: "true",
    language: lang === "es" ? "es" : "en",
    key: apiKey,
  });
  return fetchResults(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
}

/** Google Places Nearby Search — category-driven, strictly radius-bounded, denser. */
async function nearbySearch(
  apiKey: string,
  type: ExperienceType,
  lat: number,
  lng: number,
  radiusM: number,
  lang: string
): Promise<GoogleResult[]> {
  const gtype = type.googleTypes?.[0];
  if (!gtype) return [];
  const params = new URLSearchParams({
    location: `${lat.toFixed(5)},${lng.toFixed(5)}`,
    radius: String(Math.min(radiusM, 50000)),
    type: gtype,
    // only currently-open places (also excludes places without hours data)
    opennow: "true",
    language: lang === "es" ? "es" : "en",
    key: apiKey,
  });
  return fetchResults(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`);
}

function toPlace(r: GoogleResult, type: ExperienceType): Place {
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
    photoRef: r.photos?.[0]?.photo_reference,
    url: r.url,
  };
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
  lang: string
): Promise<Place[]> {
  if (!apiKey) throw new Error("no-google-key");

  const jobs: Array<Promise<GoogleResult[]>> = [textSearch(apiKey, type, lat, lng, radiusM, lang)];
  if ((type.googleTypes?.length ?? 0) > 0) {
    jobs.push(nearbySearch(apiKey, type, lat, lng, radiusM, lang));
  }

  const settled = await Promise.allSettled(jobs);
  const results = settled
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => (r as PromiseFulfilledResult<GoogleResult[]>).value);

  const seen = new Set<string>();
  return results
    .filter((r) => !r.business_status || r.business_status === "OPERATIONAL")
    .filter((r) => {
      if (seen.has(r.place_id)) return false;
      seen.add(r.place_id);
      return true;
    })
    .map((r) => toPlace(r, type));
}
