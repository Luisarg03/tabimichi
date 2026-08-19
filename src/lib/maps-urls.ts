/**
 * Google Maps universal URL builders.
 *
 * Place ids must be passed through the dedicated `query_place_id` /
 * `destination_place_id` parameters: the legacy formats (`place/?q=place_id:…`
 * and `destination=place_id:…`) are no longer resolved by Google Maps — they
 * just drop the raw id into the search box. place ids are URL-safe
 * ([A-Za-z0-9_-]), so no encoding is needed for the id itself; the human
 * query/name IS encoded.
 */

export type MapsMode = "walking" | "transit" | "car" | string;

export interface MapsPlace {
  /** place name — used as the human query/destination label */
  name: string;
  /** Google place id when this place came from Google (else null → coords) */
  googlePlaceId: string | null;
  lat: number;
  lng: number;
}

/** Google Maps search URL that opens the place DIRECTLY (name + place id),
 *  or a plain coordinate search for OSM-only places. */
export function placeUrl(place: MapsPlace): string {
  const base = "https://www.google.com/maps/search/?api=1";
  if (place.googlePlaceId) {
    return (
      `${base}&query=${encodeURIComponent(place.name)}` +
      `&query_place_id=${place.googlePlaceId}`
    );
  }
  return `${base}&query=${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;
}

/** Directions link: origin coords → destination (place id or coords). */
export function dirsUrl(
  origin: { lat: number; lng: number },
  place: MapsPlace,
  mode: MapsMode
): string {
  const travelMode = mode === "car" ? "driving" : mode; // walking | transit | driving
  const base =
    "https://www.google.com/maps/dir/?api=1" +
    `&origin=${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`;
  if (place.googlePlaceId) {
    return (
      `${base}&destination=${encodeURIComponent(place.name)}` +
      `&destination_place_id=${place.googlePlaceId}` +
      `&travelmode=${travelMode}`
    );
  }
  return (
    `${base}&destination=${place.lat.toFixed(6)},${place.lng.toFixed(6)}` +
    `&travelmode=${travelMode}`
  );
}
