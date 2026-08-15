/**
 * Google Maps universal URL builders.
 * IMPORTANT: `place_id:…` must stay RAW (unencoded) — encodeURIComponent
 * turns the colon into %3A and Google's dir/place parsers fail to resolve
 * the place. place ids are URL-safe ([A-Za-z0-9_-]), so no encoding needed.
 */

export type MapsMode = "walking" | "transit" | "car" | string;

/** "place_id:ChIJ…" when a Google place id exists, else "lat,lng". */
export function placeQueryFor(
  googlePlaceId: string | null,
  lat: number,
  lng: number
): string {
  return googlePlaceId ? `place_id:${googlePlaceId}` : `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Directions link: origin coords → destination (place_id or coords). */
export function dirsUrl(
  origin: { lat: number; lng: number },
  placeQuery: string,
  mode: MapsMode
): string {
  const travelMode = mode === "car" ? "driving" : mode; // walking | transit | driving
  return (
    "https://www.google.com/maps/dir/?api=1" +
    `&origin=${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}` +
    `&destination=${placeQuery}` +
    `&travelmode=${travelMode}`
  );
}

/** Place panel link (photos/reviews) or bare coordinates fallback. */
export function placeUrl(placeQuery: string): string {
  return placeQuery.startsWith("place_id:")
    ? `https://www.google.com/maps/place/?q=${placeQuery}`
    : `https://www.google.com/maps/search/?api=1&query=${placeQuery}`;
}
