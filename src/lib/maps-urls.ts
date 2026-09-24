/**
 * Google Maps universal URL builders.
 *
 * Place ids must be passed through the dedicated `query_place_id` /
 * `destination_place_id` parameters: the legacy formats (`place/?q=place_id:…
 * and `destination=place_id:…`) are no longer resolved by Google Maps — they
 * just drop the raw id into the search box. place ids are URL-safe
 * ([A-Za-z0-9_-]), so no encoding is needed for the id itself; the human
 * query/name IS encoded.
 */

export type MapsMode = string;

export interface MapsPlace {
  /** place name — used as the human query/destination label */
  name: string;
  /** Google place id when this place came from Google (else null → coords) */
  googlePlaceId: string | null;
  lat: number;
  lng: number;
}

const f6 = (n: number): string => n.toFixed(6);

/** `&key=name&keyId=id` when the id is known, else the name (Google resolves
 *  the business — a raw coordinate query only drops a pin meters off),
 *  else `&key=lat,lng` for unnamed rows. */
function dest(place: MapsPlace, key: string, idKey: string): string {
  if (place.googlePlaceId) {
    return `&${key}=${encodeURIComponent(place.name)}&${idKey}=${place.googlePlaceId}`;
  }
  const q = place.name?.trim();
  return q
    ? `&${key}=${encodeURIComponent(q)}`
    : `&${key}=${f6(place.lat)},${f6(place.lng)}`;
}

/** Google Maps search URL that opens the place DIRECTLY (name + place id),
 *  or a plain coordinate search for OSM-only places. */
export function placeUrl(place: MapsPlace): string {
  return `https://www.google.com/maps/search/?api=1${dest(place, "query", "query_place_id")}`;
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
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${f6(origin.lat)},${f6(origin.lng)}` +
    `${dest(place, "destination", "destination_place_id")}` +
    `&travelmode=${travelMode}`
  );
}
