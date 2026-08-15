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
  `);
  return db;
}

export function upsertPlace(p: Place): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO places (id, source, name, lat, lng, tags, rating, price_level, open_now, address, photo_ref, url, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, lat=excluded.lat, lng=excluded.lng, tags=excluded.tags,
       rating=excluded.rating, price_level=excluded.price_level, open_now=excluded.open_now,
       address=excluded.address, photo_ref=excluded.photo_ref, url=excluded.url, fetched_at=excluded.fetched_at`
  ).run(
    p.id,
    p.source,
    p.name,
    p.lat,
    p.lng,
    JSON.stringify(p.tags),
    p.rating ?? null,
    p.priceLevel ?? null,
    p.openNow === null || p.openNow === undefined ? null : p.openNow ? 1 : 0,
    p.address ?? null,
    p.photoRef ?? null,
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
  return rows.map((r) => ({
    id: String(r.id),
    source: r.source as Place["source"],
    name: String(r.name),
    lat: Number(r.lat),
    lng: Number(r.lng),
    tags: JSON.parse(String(r.tags)) as string[],
    rating: r.rating == null ? undefined : Number(r.rating),
    priceLevel: r.price_level == null ? undefined : Number(r.price_level),
    openNow: r.open_now == null ? undefined : Boolean(r.open_now),
    address: r.address ? String(r.address) : undefined,
    photoRef: r.photo_ref ? String(r.photo_ref) : undefined,
    url: r.url ? String(r.url) : undefined,
  }));
}
