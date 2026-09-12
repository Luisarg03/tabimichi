import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { placeById } from "./cache";

/**
 * Anonymous local store: user profile (tag weights) + feedback history, in
 * SQLite (node:sqlite, no native deps). This is the ONLY thing SQLite keeps —
 * the places/photo caches live in Supabase (src/lib/cache.ts) so they survive
 * serverless cold starts.
 *
 * Testability: the data dir comes from `TABI_DATA_DIR` (env) and can be
 * swapped at runtime with `setDataDir()` — tests use temp dirs and can
 * reset the connection pool between cases.
 */

let dataDir = process.env.TABI_DATA_DIR ?? path.join(process.cwd(), "data");

/** Point the store at another directory (tests) and drop open handles. */
export function setDataDir(dir: string): void {
  dataDir = dir;
  for (const d of dbs.values()) d.close();
  dbs.clear();
}

const dbs = new Map<string, DatabaseSync>();

/**
 * Open (or create) the store. Returns null when the store is unavailable —
 * e.g. on Vercel serverless the filesystem is read-only and `data/` cannot
 * be created. Callers degrade to an empty profile / no-op instead of 500ing:
 * signed-in users persist via Supabase, anonymous persistence is dev-only.
 */
function getDb(): DatabaseSync | null {
  try {
    const existing = dbs.get(dataDir);
    if (existing) return existing;
    mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, "tabi.db"));
    dbs.set(dataDir, db);
    db.exec(`
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
      CREATE TABLE IF NOT EXISTS crowd_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        place_id TEXT NOT NULL,
        level INTEGER NOT NULL,
        reported_at INTEGER NOT NULL,
        local_hour REAL NOT NULL,
        weekend INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS crowd_reports_place_idx
        ON crowd_reports (place_id, reported_at DESC);
    `);
    return db;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// M3: user profile (tag weights) from 👍/👎 feedback
// ---------------------------------------------------------------------------

/** Current tag weights: { onsen: 2, food: -1, … } — clamped to [-5, 5]. */
export function getProfile(): Record<string, number> {
  const d = getDb();
  if (!d) return {}; // store unavailable (serverless)
  const rows = d.prepare("SELECT tag, weight FROM profile_weights").all() as Array<{
    tag: string;
    weight: number;
  }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.tag] = r.weight;
  return out;
}

/** Set one tag weight directly (Tus gustos manager), clamped to [-5, 5]. */
export function setProfileWeight(tag: string, weight: number): Record<string, number> {
  const d = getDb();
  if (!d) return {};
  const clamped = Math.max(-5, Math.min(5, Math.round(weight)));
  if (clamped === 0) {
    d.prepare("DELETE FROM profile_weights WHERE tag = ?").run(tag);
  } else {
    d.prepare(
      `INSERT INTO profile_weights (tag, weight) VALUES (?, ?)
       ON CONFLICT(tag) DO UPDATE SET weight = excluded.weight`
    ).run(tag, clamped);
  }
  return getProfile();
}

/** Clear the whole learned profile (Tus gustos → reset). */
export function resetProfile(): Record<string, number> {
  const d = getDb();
  if (!d) return {};
  d.prepare("DELETE FROM profile_weights").run();
  return {};
}

// ---------------------------------------------------------------------------
// Crowd reports (anonymous / local): "how busy is it right now"
// ---------------------------------------------------------------------------

/**
 * Local store for crowd reports. Same split as feedback: it is the whole
 * store for anonymous users in local dev, and unreachable on serverless
 * (read-only fs) — signed-in users persist to Supabase instead.
 */
export function addLocalCrowdReport(report: {
  placeId: string;
  level: 0 | 1 | 2;
  at: number;
  localHour: number;
  weekend: boolean;
}): void {
  const d = getDb();
  if (!d) return;
  d.prepare(
    `INSERT INTO crowd_reports (place_id, level, reported_at, local_hour, weekend)
     VALUES (?, ?, ?, ?, ?)`
  ).run(report.placeId, report.level, report.at, report.localHour, report.weekend ? 1 : 0);
}

/** Reports for these places since `sinceMs`, newest first. Empty when the
 *  store is unavailable — the caller treats that as "no observations". */
export function getLocalCrowdReports(
  placeIds: string[],
  sinceMs: number
): Array<{ placeId: string; level: 0 | 1 | 2; at: number; localHour: number; weekend: boolean }> {
  const d = getDb();
  if (!d || placeIds.length === 0) return [];
  const placeholders = placeIds.map(() => "?").join(",");
  const rows = d
    .prepare(
      `SELECT place_id, level, reported_at, local_hour, weekend FROM crowd_reports
       WHERE place_id IN (${placeholders}) AND reported_at >= ?
       ORDER BY reported_at DESC LIMIT 500`
    )
    .all(...placeIds, sinceMs) as Array<{
    place_id: string;
    level: number;
    reported_at: number;
    local_hour: number;
    weekend: number;
  }>;
  return rows.map((r) => ({
    placeId: r.place_id,
    level: (r.level === 0 || r.level === 1 || r.level === 2 ? r.level : 1) as 0 | 1 | 2,
    at: Number(r.reported_at),
    localHour: Number(r.local_hour),
    weekend: r.weekend === 1,
  }));
}

/**
 * Record a 👍/👎 on a place and update the profile: each tag of the place
 * gets +1 (like) or −1 (dislike), clamped to [-5, 5].
 * `tags` are the tags the user actually saw on the card (preferred);
 * falls back to the cached place (Supabase) when not provided.
 */
export async function applyFeedback(
  placeId: string,
  liked: boolean,
  tags?: string[]
): Promise<Record<string, number>> {
  const d = getDb();
  if (!d) return {}; // store unavailable (serverless) — vote not persisted
  d.prepare(
    "INSERT INTO feedback (place_id, liked, created_at) VALUES (?, ?, ?)"
  ).run(placeId, liked ? 1 : 0, new Date().toISOString());

  const placeTags = tags && tags.length > 0 ? tags : (await placeById(placeId))?.tags;
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
