import type { Place } from "../types";
import type { ExperienceType } from "./taxonomy";

/**
 * Geoapify Places API (v2). Free tier: 3,000 requests/day, no credit card.
 * Built on OpenStreetMap with curated categories. Requires a free API key
 * from https://www.geoapify.com/ (signup by email).
 */

interface GeoapifyFeature {
  properties?: {
    place_id?: string;
    name?: string;
    categories?: string[];
    address_line1?: string;
    lat?: number;
    lon?: number;
  };
  geometry?: { type: string; coordinates?: [number, number] };
}

interface GeoapifyResponse {
  features?: GeoapifyFeature[];
}

/** Types with a reliable Geoapify category mapping. */
const GEOAPIFY_CATEGORIES: Record<string, string> = {
  temple: "religion.buddhist,religion.shinto",
  viewpoint: "tourism.viewpoint",
  food: "catering.restaurant,catering.cafe,catering.fast_food",
  market: "shopping.marketplace",
  museum: "entertainment.museum",
  park: "leisure.park,leisure.garden",
  shopping: "shopping.mall,shopping.department_store",
  nightlife: "catering.bar,catering.pub",
};

/** Types with no good category → full-text search within the circle. */
const GEOAPIFY_TEXT: Record<string, string> = {
  onsen: "onsen 温泉 public bath",
  sakura: "sakura hanami cherry blossom",
  trekking: "hiking trail nature walk",
};

export async function geoapifySearch(
  apiKey: string,
  types: ExperienceType[],
  lat: number,
  lng: number,
  radiusM: number,
  lang: string
): Promise<Place[]> {
  if (!apiKey) throw new Error("no-geoapify-key");

  const results = await Promise.allSettled(
    types.map(async (type) => {
      const params = new URLSearchParams({
        apiKey,
        filter: `circle:${lng.toFixed(5)},${lat.toFixed(5)},${Math.min(radiusM, 50000)}`,
        bias: `proximity:${lng.toFixed(5)},${lat.toFixed(5)}`,
        limit: "20",
        lang: lang === "es" ? "es" : "en",
      });
      const categories = GEOAPIFY_CATEGORIES[type.id];
      const text = GEOAPIFY_TEXT[type.id];
      if (categories) params.set("categories", categories);
      else if (text) params.set("text", text);
      else return [];

      const res = await fetch(`https://api.geoapify.com/v2/places?${params}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`geoapify-http-${res.status}`);
      const data = (await res.json()) as GeoapifyResponse;

      return (data.features ?? [])
        .map((f): Place | null => {
          const coords = f.geometry?.coordinates;
          const pLat = f.properties?.lat;
          const pLng = f.properties?.lon;
          const outLat = coords?.[1] ?? pLat;
          const outLng = coords?.[0] ?? pLng;
          if (outLat === undefined || outLng === undefined) return null;
          const name = f.properties?.name;
          if (!name) return null;
          return {
            id: `geo_${f.properties?.place_id ?? `${outLat.toFixed(5)},${outLng.toFixed(5)}`}`,
            source: "geoapify" as const,
            name,
            lat: outLat,
            lng: outLng,
            tags: [type.id],
            address: f.properties?.address_line1,
            openNow: null,
          } satisfies Place;
        })
        .filter((p): p is Place => p !== null);
    })
  );

  return results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => (r as PromiseFulfilledResult<Place[]>).value);
}
