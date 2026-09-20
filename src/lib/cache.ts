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

/** Columns `rowToPlace` actually reads — `select("*")` also dragged
 *  `photos_verified` and any column added later. Keep in sync with it. */
const PLACE_COLUMNS =
  "id,source,name,lat,lng,tags,rating,user_ratings_total,price_level," +
  "open_now,address,photo_ref,photo_refs,url,fetched_at,wikipedia,from_keyword," +
  "google_place_id";

/**
 * Empty-area markers live in the same table as discovery rows: one row per
 * (area, types) signature that a live search answered conclusively with
 * nothing. Without them a failing area re-spends Overpass' full 20 s budget
 * on every retry (measured: 24 requests at 20–84 s in data/logs).
 * Real ids are g_/geo_/o_/pin_, so the prefix can never collide.
 */
export const DONE_PREFIX = "__done__:";

/**
 * Google's `open_now` is a point-in-time snapshot valid only at fetch time —
 * persisting it for the whole place TTL makes everything look closed all day
 * (a row cached at 08:30 stays "closed" at 13:00). Treat it as unknown once it
 * is older than this window; the scoring then neither penalizes nor boosts it.
 */
const OPEN_NOW_FRESH_MS = 60 * 60 * 1000;

function rowToPlace(r: Record<string, unknown>): Place {
  let photoRefs: string[] | undefined;
  try {
    const parsed = JSON.parse(String(r.photo_refs ?? "null"));
    if (Array.isArray(parsed)) photoRefs = parsed as string[];
  } catch {
    // ignore
  }
  let openNow: boolean | null | undefined;
  if (r.open_now != null) {
    const fetched = new Date(String(r.fetched_at ?? "")).getTime();
    const fresh = !Number.isFinite(fetched) || Date.now() - fetched <= OPEN_NOW_FRESH_MS;
    openNow = fresh ? Boolean(r.open_now) : undefined; // stale snapshot → unknown
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
    openNow,
    address: r.address ? String(r.address) : undefined,
    photoRef: photoRefs?.[0] ?? (r.photo_ref ? String(r.photo_ref) : undefined),
    photoRefs,
    wikipedia: r.wikipedia ? String(r.wikipedia) : undefined,
    googlePlaceId: r.google_place_id ? String(r.google_place_id) : undefined,
    url: r.url ? String(r.url) : undefined,
    fromKeyword: r.from_keyword === true,
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
    wikipedia: p.wikipedia ?? null,
    google_place_id: p.googlePlaceId ?? null,
    url: p.url ?? null,
    fetched_at: new Date().toISOString(),
    from_keyword: p.fromKeyword === true,
    keyword_key: p.keywordKey ?? null,
  };
}

export async function upsertPlace(p: Place): Promise<void> {
  try {
    const { error } = await admin().from(PLACE_TABLE).upsert(placeRow(p), { onConflict: "id" });
    if (error) console.warn(`[tabi] place_cache upsert failed: ${error.message}`);
    else markColumnsPresent();
  } catch (e) {
    console.warn(`[tabi] place_cache upsert failed: ${String(e)}`);
  }
}

/**
 * Bulk-cache a merged pool. `keywordKey` stamps the rows so a repeat keyword
 * search can be served from cache without a bounding-box lookup (migration
 * 008); omit it for generic discovery.
 */
export async function cachePlaces(places: Place[], keywordKey?: string): Promise<void> {
  if (places.length === 0) return;
  try {
    // Same place can arrive from text + nearby search with slightly different
    // name/coords (discover's name-based dedupe misses it) — a bulk upsert
    // must not contain duplicate ids ("ON CONFLICT cannot affect row twice").
    // Cap matches discover()'s merged-pool cap so a dense discovery fits.
    const rows = [
      ...new Map(
        places.slice(0, 600).map((p) => [p.id, placeRow(keywordKey ? { ...p, keywordKey } : p)])
      ).values(),
    ];
    const { error } = await admin().from(PLACE_TABLE).upsert(rows, { onConflict: "id" });
    if (error) console.warn(`[tabi] place_cache bulk upsert failed: ${error.message}`);
    else markColumnsPresent();
  } catch (e) {
    console.warn(`[tabi] place_cache bulk upsert failed: ${String(e)}`);
  }
}

/** Null (not []) on failure: discovery must tell "nothing cached" apart from
 *  "the store is down". */
async function queryNear(
  lat: number,
  lng: number,
  radiusKm: number,
  limit: number,
  sinceIso?: string
): Promise<Place[] | null> {
  const deg = radiusKm / 111;
  const run = (columns: string) => {
    let q = admin()
      .from(PLACE_TABLE)
      .select(columns)
      // empty-area markers are not places — never let one into the pool
      .not("id", "like", `${DONE_PREFIX}%`)
      .gte("lat", lat - deg)
      .lte("lat", lat + deg)
      .gte("lng", lng - deg)
      .lte("lng", lng + deg);
    if (sinceIso) q = q.gte("fetched_at", sinceIso);
    return q.order("fetched_at", { ascending: false }).limit(limit);
  };
  try {
    const columns = columnsConfirmedPresent ? PLACE_COLUMNS : PLACE_COLUMNS_FALLBACK;
    let { data, error } = await run(columns);
    if (error && columns !== PLACE_COLUMNS_FALLBACK && isMissingColumn(error.message)) {
      // migration 008 not applied yet — retry wide so discovery still works
      warnMissingColumn(error.message);
      ({ data, error } = await run(PLACE_COLUMNS_FALLBACK));
    }
    if (error) {
      console.warn(`[tabi] place_cache query failed: ${error.message}`);
      return null;
    }
    return ((data as unknown as Record<string, unknown>[]) ?? []).map(rowToPlace);
  } catch (e) {
    console.warn(`[tabi] place_cache query failed: ${String(e)}`);
    return null;
  }
}

/** True once a write has been rejected for mentioning a column this database
 *  does not have yet (migration 008 not applied). */
let columnsConfirmedPresent = false;

/**
 * `from_keyword`/`keyword_key` only exist after migration 008. Selecting a
 * column the database lacks makes the WHOLE read fail, which would turn every
 * cache miss into a failed query. `select("*")` degrades to "column missing,
 * nothing cached" instead — the feature costs nothing until the migration
 * lands, and the first successful write proves the columns are there so the
 * narrow select comes back.
 *
 * ponytail: one-way latch per instance; it only ever upgrades, and a fresh
 * deploy after the migration starts narrow immediately.
 */
const PLACE_COLUMNS_FALLBACK = "*";

function isMissingColumn(message: string | undefined): boolean {
  return Boolean(message && /from_keyword|keyword_key/.test(message) && /column|schema cache/i.test(message));
}

function markColumnsPresent(): void {
  columnsConfirmedPresent = true;
}

/** Warn once per instance: an un-applied migration would otherwise log on
 *  every single discovery request. */
let warnedMissingColumn = false;

function warnMissingColumn(message: string): void {
  if (warnedMissingColumn) return;
  warnedMissingColumn = true;
  console.warn(
    `[tabi] place_cache is missing the migration-008 columns (${message}); ` +
      `serving discovery without the keyword cache. Run migration 008.`
  );
}

/**
 * Rows discovered for one keyword, newest first. Returns null when the store
 * is unavailable — the caller MUST NOT read that as "this keyword found
 * nothing" (that would cache an outage as a definitive empty answer).
 *
 * The bounding box is NOT optional: without it the 600-row cap is filled by
 * whichever region asked most recently, and a keyword searched in Tokyo would
 * hide the same keyword's Osaka pool. The box is the caller's radius plus a
 * wide margin, because `discover` serves cached keyword rows without
 * re-applying a radius bound.
 */
async function queryKeyword(
  keywordKey: string,
  lat: number,
  lng: number,
  radiusKm: number,
  limit: number,
  sinceIso?: string
): Promise<Place[] | null> {
  const deg = (radiusKm * 4) / 111;
  const run = (columns: string) => {
    let q = admin()
      .from(PLACE_TABLE)
      .select(columns)
      .eq("keyword_key", keywordKey)
      .gte("lat", lat - deg)
      .lte("lat", lat + deg)
      .gte("lng", lng - deg)
      .lte("lng", lng + deg);
    if (sinceIso) q = q.gte("fetched_at", sinceIso);
    return q.order("fetched_at", { ascending: false }).limit(limit);
  };
  try {
    const columns = columnsConfirmedPresent ? PLACE_COLUMNS : PLACE_COLUMNS_FALLBACK;
    let { data, error } = await run(columns);
    if (error && columns !== PLACE_COLUMNS_FALLBACK && isMissingColumn(error.message)) {
      // migration 008 not applied yet — retry wide so the app keeps working
      warnMissingColumn(error.message);
      ({ data, error } = await run(PLACE_COLUMNS_FALLBACK));
    }
    if (error) {
      console.warn(`[tabi] place_cache keyword query failed: ${error.message}`);
      return null;
    }
    return ((data as unknown as Record<string, unknown>[]) ?? []).map(rowToPlace);
  } catch (e) {
    console.warn(`[tabi] place_cache keyword query failed: ${String(e)}`);
    return null;
  }
}

/** Places cached near a point (rough bounding box), newest first. Degrades to
 *  [] — this is the last-resort pool, where empty and unavailable are the
 *  same thing for the caller. */
export async function cachedNear(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<Place[]> {
  return (await queryNear(lat, lng, radiusKm, 200)) ?? [];
}

/**
 * Outcome of a discovery cache read. Three states, because discovery must
 * never confuse them:
 *  - found:  a pool is servable now
 *  - empty:  the store was consulted and has nothing — for a keyword that is
 *            the real answer ("this query matched nothing"), so discovery can
 *            return it instead of asking the sources again
 *  - miss:   nothing is known (coverage incomplete, keyword never searched,
 *            or the store failed) — discovery must go live. A failed store
 *            MUST NOT read as "empty", or the user is told a keyword matched
 *            nothing when in truth nobody asked.
 */
export type FreshResult =
  | { status: "found"; places: Place[] }
  | { status: "empty" }
  | { status: "miss" };

/**
 * Fresh-cache check for discovery: places fetched within maxAgeMs near a
 * point, covered for every requested type. With `keywordKey` the pool is
 * looked up by keyword instead of by bounding box (a keyword answer is the
 * same set of places wherever the user stands; `discover` re-applies its
 * radius bound before serving it) and the type-coverage rule does not apply,
 * because keyword results rank by intent rather than by category.
 */
export async function freshNearby(
  lat: number,
  lng: number,
  radiusKm: number,
  types: string[],
  maxAgeMs: number,
  keywordKey?: string
): Promise<FreshResult> {
  const since = new Date(Date.now() - maxAgeMs).toISOString();
  if (keywordKey) {
    const places = await queryKeyword(keywordKey, lat, lng, radiusKm, 600, since);
    if (places === null) return { status: "miss" };
    if (places.length > 0) return { status: "found", places };
    // Zero rows is ambiguous on its own: a keyword never searched leaves no
    // rows either. The empty-marker is what proves the query actually ran and
    // matched nothing, so only then is "empty" a real answer.
    const answered = await discoveryDone(lat, lng, types, keywordKey);
    return answered ? { status: "empty" } : { status: "miss" };
  }
  const places = await queryNear(lat, lng, radiusKm, 600, since);
  if (places === null) return { status: "miss" };
  for (const type of types) {
    if (!places.some((p) => p.tags.includes(type))) return { status: "miss" };
  }
  return { status: "found", places };
}

// ---------------------------------------------------------------------------
// Empty-area markers (negative cache)
// ---------------------------------------------------------------------------

/** Windows for "a live search found nothing here". Short for a generic area
 *  (a source outage must not freeze an area for long) and long for a keyword
 *  (Google's answer to an explicit query is authoritative). */
export const EMPTY_AREA_TTL_MS = 10 * 60 * 1000;
export const EMPTY_KEYWORD_TTL_MS = 6 * 60 * 60 * 1000;

/** Stable id for one discovery signature: ~110 m of coordinate rounding
 *  (same tolerance the name-based dedupe uses), sorted types, keyword. */
function doneMarkerId(
  lat: number,
  lng: number,
  types: string[],
  keywordKey?: string
): string {
  const kind = keywordKey ? `kw:${keywordKey}` : `t:${[...types].sort().join("+")}`;
  return `${DONE_PREFIX}${lat.toFixed(3)},${lng.toFixed(3)}|${kind}`;
}

/** Was this exact area+types (or keyword) already answered with nothing? */
export async function discoveryDone(
  lat: number,
  lng: number,
  types: string[],
  keywordKey?: string
): Promise<boolean> {
  const id = doneMarkerId(lat, lng, types, keywordKey);
  const ttl = keywordKey ? EMPTY_KEYWORD_TTL_MS : EMPTY_AREA_TTL_MS;
  const since = new Date(Date.now() - ttl).toISOString();
  try {
    const { data, error } = await admin()
      .from(PLACE_TABLE)
      .select("id")
      .eq("id", id)
      .gte("fetched_at", since)
      .maybeSingle();
    return !error && data != null;
  } catch {
    return false;
  }
}

/** Remember a conclusive empty result. Callers must only invoke this when a
 *  source actually answered — never when every source failed (that would
 *  cache an outage as "nothing here"). */
export async function markDiscoveryDone(
  lat: number,
  lng: number,
  types: string[],
  keywordKey?: string
): Promise<void> {
  const id = doneMarkerId(lat, lng, types, keywordKey);
  try {
    const { error } = await admin()
      .from(PLACE_TABLE)
      .upsert(
        {
          id,
          source: "overpass",
          name: "",
          lat,
          lng,
          tags: "[]",
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
    if (error) console.warn(`[tabi] discovery marker upsert failed: ${error.message}`);
  } catch (e) {
    console.warn(`[tabi] discovery marker upsert failed: ${String(e)}`);
  }
}

/** Escape ILIKE wildcards so user input matches literally. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Name/address search over the cached pool (autocomplete local source).
 * Uses ILIKE (accelerated by the pg_trgm GIN index from migration 005) and
 * returns a superset — the caller ranks by match tier and distance. Degrades
 * to [] on any error: local cache must never break suggestions.
 */
export async function searchCachedPlaces(q: string, limit = 12): Promise<Place[]> {
  const nq = escapeLike(q);
  try {
    const { data, error } = await admin()
      .from(PLACE_TABLE)
      .select("*")
      .or(`name.ilike.%${nq}%,address.ilike.%${nq}%`)
      .order("fetched_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit * 3, 60)));
    if (error) {
      console.warn(`[tabi] place_cache search failed: ${error.message}`);
      return [];
    }
    return ((data as Record<string, unknown>[]) ?? []).map(rowToPlace);
  } catch (e) {
    console.warn(`[tabi] place_cache search failed: ${String(e)}`);
    return [];
  }
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
