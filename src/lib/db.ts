import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Place } from "./types";

/**
 * SQLite cache of discovered places + (later) user profile & feedback.
 * Uses node:sqlite (built into Node >= 22.5) — no native deps.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "tabi.db");

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      tags TEXT NOT NULL,
      rating REAL,
      price_level INTEGER,
      open_now INTEGER,
      address TEXT,
      photo_ref TEXT,
      url TEXT,
      fetched_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_places_ll ON places(lat, lng);
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id TEXT NOT NULL,
      liked INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile_weights (
      tag TEXT PRIMARY KEY,
      weight INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photo_hashes (
      place_id TEXT NOT NULL,
      ref TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (place_id, ref)
    );
  `);
  // lightweight migrations: popularity + gallery columns on existing databases
  try {
    db.exec("ALTER TABLE places ADD COLUMN user_ratings_total INTEGER");
  } catch {
    // column already exists
  }
  try {
    db.exec("ALTER TABLE places ADD COLUMN photo_refs TEXT");
  } catch {
    // column already exists
  }
  try {
    db.exec("ALTER TABLE places ADD COLUMN photos_verified INTEGER DEFAULT 0");
  } catch {
    // column already exists
  }
  return db;
}

/** Photo dedupe bookkeeping (hashes of already-seen images per place). */
export function photoHashesFor(placeId: string): Set<string> {
  const d = getDb();
  const rows = d
    .prepare("SELECT hash FROM photo_hashes WHERE place_id = ?")
    .all(placeId) as Array<{ hash: string }>;
  return new Set(rows.map((r) => r.hash));
}

export function rememberPhotoHash(placeId: string, ref: string, hash: string): void {
  const d = getDb();
  d.prepare("INSERT OR REPLACE INTO photo_hashes (place_id, ref, hash) VALUES (?, ?, ?)").run(
    placeId,
    ref,
    hash
  );
}

export function photosVerified(id: string): boolean {
  const d = getDb();
  const r = d.prepare("SELECT photos_verified FROM places WHERE id = ?").get(id) as
    | { photos_verified: number }
    | undefined;
  return r?.photos_verified === 1;
}

export function setPhotosVerified(id: string, verified: boolean): void {
  const d = getDb();
  d.prepare("UPDATE places SET photos_verified = ? WHERE id = ?").run(verified ? 1 : 0, id);
}

/** Map a SQLite row to a Place. */
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

export function upsertPlace(p: Place): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO places (id, source, name, lat, lng, tags, rating, user_ratings_total, price_level, open_now, address, photo_ref, photo_refs, url, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, lat=excluded.lat, lng=excluded.lng, tags=excluded.tags,
       rating=excluded.rating, user_ratings_total=excluded.user_ratings_total,
       price_level=excluded.price_level, open_now=excluded.open_now,
       address=excluded.address, photo_ref=excluded.photo_ref, photo_refs=excluded.photo_refs,
       url=excluded.url, fetched_at=excluded.fetched_at`
  ).run(
    p.id,
    p.source,
    p.name,
    p.lat,
    p.lng,
    JSON.stringify(p.tags),
    p.rating ?? null,
    p.userRatingsTotal ?? null,
    p.priceLevel ?? null,
    p.openNow === null || p.openNow === undefined ? null : p.openNow ? 1 : 0,
    p.address ?? null,
    p.photoRef ?? null,
    p.photoRefs && p.photoRefs.length > 0 ? JSON.stringify(p.photoRefs) : null,
    p.url ?? null,
    new Date().toISOString()
  );
}

export function cachePlaces(places: Place[]): void {
  for (const p of places) upsertPlace(p);
}

/** Places cached near a point (rough bounding box), newest first. */
export function cachedNear(lat: number, lng: number, radiusKm: number): Place[] {
  const d = getDb();
  const deg = radiusKm / 111;
  const rows = d
    .prepare(
      `SELECT * FROM places
       WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
       ORDER BY fetched_at DESC LIMIT 200`
    )
    .all(lat - deg, lat + deg, lng - deg, lng + deg) as Array<Record<string, unknown>>;
  return rows.map(rowToPlace);
}

/** One cached place by id (used by the feedback/profile flow). */
export function placeById(id: string): Place | null {
  const d = getDb();
  const r = d.prepare("SELECT * FROM places WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToPlace(r) : null;
}

/**
 * Fresh-cache check for discovery: places fetched within maxAgeMs near a point,
 * filtered to those whose tags cover every requested type. Returns null when
 * coverage is incomplete — the caller should hit live sources instead.
 */
export function freshNearby(
  lat: number,
  lng: number,
  radiusKm: number,
  types: string[],
  maxAgeMs: number
): Place[] | null {
  const d = getDb();
  const deg = radiusKm / 111;
  const since = new Date(Date.now() - maxAgeMs).toISOString();
  const rows = d
    .prepare(
      `SELECT * FROM places
       WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
         AND fetched_at >= ?
       ORDER BY fetched_at DESC LIMIT 300`
    )
    .all(lat - deg, lat + deg, lng - deg, lng + deg, since) as Array<Record<string, unknown>>;

  const places = rows.map(rowToPlace);

  // every requested type must have at least one fresh cached place
  for (const type of types) {
    if (!places.some((p) => p.tags.includes(type))) return null;
  }
  return places;
}

// ---------------------------------------------------------------------------
// M3: user profile (tag weights) from 👍/👎 feedback
// ---------------------------------------------------------------------------

/** Current tag weights: { onsen: 2, food: -1, … } — clamped to [-5, 5]. */
export function getProfile(): Record<string, number> {
  const d = getDb();
  const rows = d.prepare("SELECT tag, weight FROM profile_weights").all() as Array<{
    tag: string;
    weight: number;
  }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.tag] = r.weight;
  return out;
}

/**
 * Record a 👍/👎 on a place and update the profile: each tag of the place
 * gets +1 (like) or −1 (dislike), clamped to [-5, 5].
 * `tags` are the tags the user actually saw on the card (preferred);
 * falls back to the cached place when not provided.
 */
export function applyFeedback(
  placeId: string,
  liked: boolean,
  tags?: string[]
): Record<string, number> {
  const d = getDb();
  d.prepare(
    "INSERT INTO feedback (place_id, liked, created_at) VALUES (?, ?, ?)"
  ).run(placeId, liked ? 1 : 0, new Date().toISOString());

  const placeTags = tags && tags.length > 0 ? tags : placeById(placeId)?.tags;
  if (placeTags && placeTags.length > 0) {
    const delta = liked ? 1 : -1;
    const upsert = d.prepare(
      `INSERT INTO profile_weights (tag, weight) VALUES (?, ?)
       ON CONFLICT(tag) DO UPDATE SET
         weight = MAX(-5, MIN(5, profile_weights.weight + excluded.weight))`
    );
    for (const tag of placeTags) upsert.run(tag, delta);
  }
  return getProfile();
}
