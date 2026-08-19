import type { Place } from "./types";
import { getSupabaseAdmin } from "./supabase/server";

/**
 * Server-side cache in Supabase so it survives serverless cold starts:
 * places in the `place_cache` Postgres table, photo bytes in the private
 * `photos` Storage bucket (served through /api/photo with the requesting
 * user's own key). Service role only — RLS denies everyone else.
 *
 * Every call degrades to a miss on error: a cache hiccup must never fail
 * discovery or photo serving, just re-fetch from the live source.
 */

type AdminClient = ReturnType<typeof getSupabaseAdmin>;
let adminFactory: () => AdminClient = getSupabaseAdmin;

/** Test seam — same pattern as db.setDataDir(). */
export function setAdminForTests(fn: () => AdminClient): void {
  adminFactory = fn;
}

function admin(): AdminClient {
  return adminFactory();
}

const PLACE_TABLE = "place_cache";
const PHOTO_BUCKET = "photos";

function rowToPlace(r: Record<string, unknown>): Place {
  let photoRefs: string[] | undefined;
  try {
    const parsed = JSON.parse(String(r.photo_refs ?? "null"));
    if (Array.isArray(parsed)) photoRefs = parsed as string[];
  } catch {
    // ignore
  }
  return {
    id: String(r.id),
    source: r.source as Place["source"],
    name: String(r.name),
    lat: Number(r.lat),
    lng: Number(r.lng),
    tags: JSON.parse(String(r.tags)) as string[],
    rating: r.rating == null ? undefined : Number(r.rating),
    userRatingsTotal: r.user_ratings_total == null ? undefined : Number(r.user_ratings_total),
    priceLevel: r.price_level == null ? undefined : Number(r.price_level),
    openNow: r.open_now == null ? undefined : Boolean(r.open_now),
    address: r.address ? String(r.address) : undefined,
    photoRef: photoRefs?.[0] ?? (r.photo_ref ? String(r.photo_ref) : undefined),
    photoRefs,
    url: r.url ? String(r.url) : undefined,
  };
}

function placeRow(p: Place): Record<string, unknown> {
  return {
    id: p.id,
    source: p.source,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    tags: JSON.stringify(p.tags),
    rating: p.rating ?? null,
    user_ratings_total: p.userRatingsTotal ?? null,
    price_level: p.priceLevel ?? null,
    open_now: p.openNow == null ? null : p.openNow ? 1 : 0,
    address: p.address ?? null,
    photo_ref: p.photoRef ?? null,
    photo_refs: p.photoRefs && p.photoRefs.length > 0 ? JSON.stringify(p.photoRefs) : null,
    url: p.url ?? null,
    fetched_at: new Date().toISOString(),
  };
}

export async function upsertPlace(p: Place): Promise<void> {
  try {
    const { error } = await admin().from(PLACE_TABLE).upsert(placeRow(p), { onConflict: "id" });
    if (error) console.warn(`[tabi] place_cache upsert failed: ${error.message}`);
  } catch (e) {
    console.warn(`[tabi] place_cache upsert failed: ${String(e)}`);
  }
}

export async function cachePlaces(places: Place[]): Promise<void> {
  if (places.length === 0) return;
  try {
    // Same place can arrive from text + nearby search with slightly different
    // name/coords (discover's name-based dedupe misses it) — a bulk upsert
    // must not contain duplicate ids ("ON CONFLICT cannot affect row twice").
    const rows = [...new Map(places.slice(0, 500).map((p) => [p.id, placeRow(p)])).values()];
    const { error } = await admin().from(PLACE_TABLE).upsert(rows, { onConflict: "id" });
    if (error) console.warn(`[tabi] place_cache bulk upsert failed: ${error.message}`);
  } catch (e) {
    console.warn(`[tabi] place_cache bulk upsert failed: ${String(e)}`);
  }
}

async function queryNear(
  lat: number,
  lng: number,
  radiusKm: number,
  limit: number,
  sinceIso?: string
): Promise<Place[]> {
  try {
    const deg = radiusKm / 111;
    let q = admin()
      .from(PLACE_TABLE)
      .select("*")
      .gte("lat", lat - deg)
      .lte("lat", lat + deg)
      .gte("lng", lng - deg)
      .lte("lng", lng + deg);
    if (sinceIso) q = q.gte("fetched_at", sinceIso);
    const { data, error } = await q.order("fetched_at", { ascending: false }).limit(limit);
    if (error) {
      console.warn(`[tabi] place_cache query failed: ${error.message}`);
      return [];
    }
    return ((data as Record<string, unknown>[]) ?? []).map(rowToPlace);
  } catch (e) {
    console.warn(`[tabi] place_cache query failed: ${String(e)}`);
    return [];
  }
}

/** Places cached near a point (rough bounding box), newest first. */
export async function cachedNear(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<Place[]> {
  return queryNear(lat, lng, radiusKm, 200);
}

/**
 * Fresh-cache check for discovery: places fetched within maxAgeMs near a point,
 * filtered to those whose tags cover every requested type. Returns null when
 * coverage is incomplete — the caller should hit live sources instead.
 */
export async function freshNearby(
  lat: number,
  lng: number,
  radiusKm: number,
  types: string[],
  maxAgeMs: number
): Promise<Place[] | null> {
  const since = new Date(Date.now() - maxAgeMs).toISOString();
  const places = await queryNear(lat, lng, radiusKm, 300, since);
  for (const type of types) {
    if (!places.some((p) => p.tags.includes(type))) return null;
  }
  return places;
}

/** One cached place by id (used by the photo enrichment + feedback flow). */
export async function placeById(id: string): Promise<Place | null> {
  try {
    const { data, error } = await admin().from(PLACE_TABLE).select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return rowToPlace(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** True when this place's photos were already enriched (skips Place Details). */
export async function photosVerified(id: string): Promise<boolean> {
  try {
    const { data, error } = await admin()
      .from(PLACE_TABLE)
      .select("photos_verified")
      .eq("id", id)
      .maybeSingle();
    return !error && (data as { photos_verified?: boolean } | null)?.photos_verified === true;
  } catch {
    return false;
  }
}

export async function setPhotosVerified(id: string, verified: boolean): Promise<void> {
  try {
    const { error } = await admin().from(PLACE_TABLE).update({ photos_verified: verified }).eq("id", id);
    if (error) console.warn(`[tabi] place_cache update failed: ${error.message}`);
  } catch {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// Photo bytes cache (Supabase Storage)
// ---------------------------------------------------------------------------

function photoKey(id: string, ref: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const refPart = ref.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  return `${safeId}__${refPart}.jpg`;
}

export async function readCachedPhoto(id: string, ref: string): Promise<Buffer | null> {
  try {
    const { data, error } = await admin().storage.from(PHOTO_BUCKET).download(photoKey(id, ref));
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

export async function writeCachedPhoto(id: string, ref: string, buf: Buffer): Promise<void> {
  try {
    const { error } = await admin()
      .storage.from(PHOTO_BUCKET)
      .upload(photoKey(id, ref), new Uint8Array(buf), {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (error) console.warn(`[tabi] photo cache upload failed: ${error.message}`);
  } catch {
    // cache failure is not fatal
  }
}
