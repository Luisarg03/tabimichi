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

/** Google Maps search URL that opens the place directly.
 *
 *  Priority: place id (exact identity) → NAME (Google resolves the business,
 *  which is what the user actually wants: a raw coordinate query only drops a
 *  pin "a few meters off" and makes them hunt among everything around).
 *  Coordinates are the last resort, kept only for unnamed rows. */
export function placeUrl(place: MapsPlace): string {
  const base = "https://www.google.com/maps/search/?api=1";
  if (place.googlePlaceId) {
    return (
      `${base}&query=${encodeURIComponent(place.name)}` +
      `&query_place_id=${place.googlePlaceId}`
    );
  }
  const q = place.name?.trim();
  return q
    ? `${base}&query=${encodeURIComponent(q)}`
    : `${base}&query=${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;
}

/** Directions link: origin coords → destination (place id, name, or coords).
 *  Same priority as placeUrl: an id resolves exactly, a name gets Google's own
 *  listing as destination, coordinates are the unnamed fallback. */
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
  const destination = place.name?.trim()
    ? encodeURIComponent(place.name.trim())
    : `${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;
  return `${base}&destination=${destination}&travelmode=${travelMode}`;
}
