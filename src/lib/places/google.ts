import type { Place } from "../types";
import type { ExperienceType } from "./taxonomy";

interface GoogleResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  geometry: { location: { lat: number; lng: number } };
  rating?: number;
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

/**
 * Google Places Text Search for one experience type.
 * Throws if the API key is missing or the request fails — the
 * orchestrator falls back to Overpass.
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

  const params = new URLSearchParams({
    query: `${type.googleQuery} near ${lat.toFixed(4)},${lng.toFixed(4)}`,
    location: `${lat.toFixed(5)},${lng.toFixed(5)}`,
    radius: String(Math.min(radiusM, 50000)),
    language: lang === "es" ? "es" : "en",
    key: apiKey,
  });

  const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`google-http-${res.status}`);
  const data = (await res.json()) as GoogleResponse;
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`google-status-${data.status}`);
  }

  return data.results
    .filter((r) => !r.business_status || r.business_status === "OPERATIONAL")
    .map((r) => ({
      id: `g_${r.place_id}`,
      source: "google" as const,
      name: r.name,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      tags: [type.id],
      rating: r.rating,
      priceLevel: r.price_level,
      openNow: r.opening_hours?.open_now ?? null,
      address: r.formatted_address,
      photoRef: r.photos?.[0]?.photo_reference,
      url: r.url,
    }));
}
