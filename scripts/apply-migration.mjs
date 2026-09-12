#!/usr/bin/env node
/**
 * Apply a SQL migration through the Supabase Management API.
 *
 * Why this exists instead of `supabase db push`: on this machine the direct
 * database host (db.<ref>.supabase.co) does not resolve — neither A nor AAAA —
 * so the CLI fails at "Initialising login role" with a connection timeout. The
 * poolers resolve fine, and the Management API needs no DB password at all.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-migration.mjs <file.sql>
 *
 * The token is a personal access token (Dashboard → Account → Access Tokens),
 * NOT the anon/service keys. It is read from the environment only and never
 * written to disk or printed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "yfwslmehyaftomzmkafs";
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();

const file = process.argv[2];
if (!file) {
  console.error("usage: SUPABASE_ACCESS_TOKEN=... node scripts/apply-migration.mjs <file.sql>");
  process.exit(2);
}
if (!token) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is required.\n" +
      "Get one at Dashboard → Account → Access Tokens, then:\n" +
      "  SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-migration.mjs supabase/migrations/008_discovery_cache.sql"
  );
  process.exit(2);
}

const sql = readFileSync(path.resolve(file), "utf8");
console.log(`→ ${PROJECT_REF} ← ${file} (${sql.length} bytes)`);

const res = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(120_000),
  }
);

const text = await res.text();
if (!res.ok) {
  console.error(`✗ HTTP ${res.status}`);
  console.error(text.slice(0, 2000));
  process.exit(1);
}
console.log(`✓ HTTP ${res.status} — respuesta: ${text.slice(0, 500) || "(vacía)"}`);
