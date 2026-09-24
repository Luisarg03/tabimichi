/**
 * Render a `.env` file from the Bitwarden vault (single source of truth).
 *
 *   pnpm secrets [local|sandbox|production] [--check]
 *
 * One secure note per environment holds the whole `KEY=value` payload:
 *
 *   Tabi dev (local)  → .env.local
 *   Tabi sandbox      → .env.sandbox
 *   Tabi production   → .env.production
 *
 * The names live in ENVS below and must stay in step with the `upsert` calls in
 * `secrets-notes.sh`, which creates them; `secrets.test.mjs` asserts the two
 * agree, because nothing at runtime connects them and a rename on one side
 * shows up only as "no vault item named …" on a note that plainly exists.
 *
 * These are flat item names, deliberately not `Tabi/local`. `bw get` matches on
 * the item's own name (and a type-dependent subtitle), not on its folder path,
 * so a slash implies a hierarchy the CLI does not resolve by that string.
 * Put them in a "Tabi" folder for tidiness if you like — the script looks them
 * up by name either way.
 *
 * `local` and `sandbox` are auto-loaded by Next (`pnpm dev` reads `.env.local`;
 * `next dev --env-file`/NODE_ENV=test additionally read `.env.<env>.local`).
 * `.env.sandbox` and `.env.production` are NOT auto-loaded — they exist to be
 * pasted into Vercel's Preview and Production scopes, which stay the authority
 * for deployed environments. That is deliberate: a checked-out `.env.production`
 * must never silently override a production build.
 *
 * This is the only thing that writes those files: `vercel env pull` used to,
 * and then neither side knew which one had won.
 *
 * The values are re-emitted double-quoted. That is not cosmetic — dotenv ends
 * an unquoted value at the first `#` (even without a space before it) and trims
 * surrounding whitespace, so an unquoted secret containing `#` loads truncated
 * and a passphrase with trailing spaces loads silently altered. Quoting is
 * verified by round-tripping the output through dotenv's own parser in the
 * test alongside this file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** dotenv's key grammar: `[\w.-]+`, so `MY-KEY` and `A.B` are legal too. */
const KEY = "[\\w.-]+";
// No `\s*$` here: rawValue must keep the trailing spaces so they can be
// reported instead of silently absorbed by the match.
const LINE = new RegExp(`^\\s*(?:export\\s+)?(${KEY})\\s*=(.*)$`);
/** Environment → vault note name. Must match scripts/secrets-notes.sh. */
const ENVS = {
  local: "Tabi dev (local)",
  sandbox: "Tabi sandbox",
  production: "Tabi production",
};

/**
 * Where the `bw` CLI keeps its vault. It defaults to `$HOME/.config`, which is
 * read-only in sandboxes and containers — and a CLI that cannot write its lock
 * file dies with an opaque EROFS instead of reporting "locked".
 */
function bwEnv() {
  const base = process.env.XDG_CONFIG_HOME || `${process.env.HOME || ""}/.config`;
  return {
    ...process.env,
    BITWARDENCLI_APPDATA_DIR: process.env.BITWARDENCLI_APPDATA_DIR || `${base}/Bitwarden CLI`,
  };
}

/**
 * Turn the vault note into a `.env` body, or refuse.
 *
 * dotenv *ignores* a malformed line instead of failing, so a typo in the note
 * normally surfaces later as a missing variable — or as a variable whose value
 * silently lost its tail. Both are caught here, before anything is written.
 */
/**
 * The role a Supabase JWT claims. `anon` is meant to be public — RLS is what
 * protects the data — while `service_role` bypasses RLS entirely. Length cannot
 * tell them apart: both run past 150 chars. Reading the claim can.
 */
function jwtRole(token) {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof claims?.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

/** Non-JWT secrets, which carry no role claim to inspect. */
const SECRET_KEY_PATTERN = /^(sb_secret_|sk_live_|sk-|ghp_|github_pat_|xox[baprs]-)/;

export function render(note) {
  const pairs = [];
  const seen = new Set();

  for (const [i, raw] of note.replace(/\r\n?/g, "\n").split("\n").entries()) {
    if (raw.trim() === "" || /^\s*#/.test(raw)) continue;

    const match = raw.match(LINE);
    if (!match) {
      throw new Error(
        `line ${i + 1} is not KEY=value, and dotenv would ignore it:\n  ${raw.trim()}\n` +
          `One KEY=value per line; multiline values are not supported.`,
      );
    }

    const [, key, rawValue] = match;
    const quoted = /^(["'`])[\s\S]*\1$/.test(rawValue);

    if (!quoted && rawValue.includes("#")) {
      // dotenv reads this as a comment and loads only what precedes it. A note
      // is typed by hand, so an unquoted `#` is far more likely to be part of
      // the secret than an inline comment — refuse instead of guessing.
      throw new Error(
        `line ${i + 1} (${key}) has an unquoted #, which dotenv reads as a comment.\n` +
          `  ${rawValue}\n` +
          `Quote the whole value if the # is part of it:\n  ${key}="${rawValue}"`,
      );
    }

    if (!quoted && rawValue !== rawValue.trim()) {
      // dotenv trims an unquoted value. Whitespace in a secret is usually
      // deliberate (a passphrase), so trimming it silently is a silent edit.
      throw new Error(
        `line ${i + 1} (${key}) has surrounding whitespace, which dotenv trims.\n` +
          `  ${JSON.stringify(rawValue)}\n` +
          `Quote the whole value to keep it, or remove the spaces.`,
      );
    }

    const value = quoted ? rawValue.slice(1, -1) : rawValue;

    if (value === "") {
      throw new Error(`line ${i + 1} (${key}) has an empty value — remove it or fill it in.`);
    }
    if (seen.has(key)) throw new Error(`${key} is defined twice (line ${i + 1}).`);
    seen.add(key);
    pairs.push([key, value]);

    // dotenv unquotes by matching the first and last character, so a value
    // holding both quote styles cannot survive a round trip.
    if (value.includes('"') && value.includes("'")) {
      throw new Error(`${key} contains both " and ' — dotenv cannot quote it safely.`);
    }
  }

  if (pairs.length === 0) throw new Error("the note has no KEY=value entries.");

  // NEXT_PUBLIC_* is inlined into the browser bundle, so a real secret there is
  // a leak. The anon key is NOT one: it is designed to be shipped, and RLS is
  // what protects the data. Flagging it would block the correct configuration.
  for (const [key, value] of pairs) {
    if (!/^NEXT_PUBLIC_/.test(key) || key.endsWith("_URL")) continue;

    const role = jwtRole(value);
    const isServiceRole = role === "service_role";
    if (isServiceRole || SECRET_KEY_PATTERN.test(value)) {
      const what = isServiceRole ? "a service_role JWT (it bypasses RLS)" : "a private key";
      throw new Error(
        `${key} is NEXT_PUBLIC_* but holds ${what}.\n` +
          `Next.js inlines NEXT_PUBLIC_* into the browser bundle — move it out.`,
      );
    }
  }

  const body = pairs
    .map(([key, value]) => {
      const quote = value.includes('"') ? "'" : '"';
      return `${key}=${quote}${value}${quote}`;
    })
    .join("\n");

  return { text: `${body}\n`, count: pairs.length };
}

/**
 * Names close to `want`, so "no vault item named X" can say "did you mean Y?".
 *
 * A rename in Bitwarden is invisible to every other check here — the test only
 * compares the two scripts with each other, never the vault. So the moment the
 * lookup fails is the only chance to notice that the note exists under a name
 * one word off, which is exactly what happened with "Tabi prod" vs
 * "Tabi production".
 */
export function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Same segments except a trailing abbreviation of the last one:
 * "tabi prod" → "tabi production". Levenshtein cannot see this (the distance
 * is 6, a typo is 1) and a plain prefix test cannot either, since the prefix
 * ends mid-word. Segment-wise is what the names actually mean.
 *
 * Exported for the test: a false positive here is worse than no hint at all,
 * because it sends you off to rename the wrong note.
 */
export function isAbbreviationOf(name, want) {
  const a = name.toLowerCase().split(/\s+/);
  const b = want.toLowerCase().split(/\s+/);
  if (a.length !== b.length || a.length === 0) return false;
  const head = a.slice(0, -1);
  if (!head.every((seg, i) => seg === b[i])) return false;
  const lastA = a.at(-1);
  const lastB = b.at(-1);
  return lastA.length >= 3 && lastA !== lastB && lastB.startsWith(lastA);
}

function similarItemNames(item) {
  const res = spawnSync("bw", ["list", "items", "--session", process.env.BW_SESSION ?? ""], {
    encoding: "utf8",
    env: bwEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) return [];
  let items;
  try {
    items = JSON.parse(res.stdout);
  } catch {
    return [];
  }
  const want = item.toLowerCase();
  return items
    .map((i) => i.name)
    .filter((n) => typeof n === "string")
    .filter((n) => {
      const candidate = n.toLowerCase();
      // A typo ("producion") or an abbreviation ("prod"), never a sibling env.
      return (
        editDistance(candidate, want) <= Math.max(2, Math.floor(want.length * 0.2)) ||
        isAbbreviationOf(n, item)
      );
    })
    .slice(0, 5);
}

function readNote(item) {
  const session = process.env.BW_SESSION?.trim();
  if (!session) throw new Error("BW_SESSION is empty — run this through `pnpm secrets`.");

  const res = spawnSync("bw", ["get", "notes", item, "--raw", "--session", session], {
    encoding: "utf8",
    env: bwEnv(),
  });
  if (res.error) {
    if (res.error.code === "ENOENT") {
      throw new Error("'bw' is not on PATH. Install it: https://bitwarden.com/help/cli/");
    }
    throw new Error(`could not run bw: ${res.error.message}`);
  }
  if (res.status !== 0) {
    const err = `${res.stderr || res.stdout || ""}`.trim();
    if (/EROFS|read-only file system/i.test(err)) {
      throw new Error("bw cannot write its vault state — set BITWARDENCLI_APPDATA_DIR.");
    }
    if (/not found/i.test(err)) {
      const near = similarItemNames(item);
      throw new Error(
        `no vault item named "${item}" — create it (see README).` +
          (near.length ? `\n\nDid you mean one of these?\n${near.map((n) => `  • ${n}`).join("\n")}` : ""),
      );
    }
    if (/not logged in|locked|invalid|decrypt/i.test(err)) {
      throw new Error(`bw refused the session — run \`bw unlock --raw\` again.\n${err}`);
    }
    throw new Error(`bw exited ${res.status}: ${err}`);
  }
  return res.stdout;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const env = args.find((a) => !a.startsWith("--")) || "local";

  const item = ENVS[env];
  if (!item) throw new Error(`unknown environment "${env}" — use ${Object.keys(ENVS).join(", ")}.`);
  const out = `.env${env === "local" ? ".local" : `.${env}`}`;

  const { text, count } = render(readNote(item));

  if (check) {
    let current;
    try {
      current = readFileSync(out, "utf8");
    } catch {
      current = null;
    }
    if (current === text) {
      console.log(`✓ ${out} matches "${item}" (${count} vars).`);
      return;
    }
    console.error(`✗ ${out} does not match "${item}" — run \`pnpm secrets ${env}\`.`);
    process.exit(1);
  }

  writeFileSync(out, text, { mode: 0o600 });
  console.log(`✓ wrote ${out} from "${item}" (${count} vars, mode 600).`);
}

// Guarded so `render` can be imported and exercised on its own.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`secrets: ${err.message}`);
    process.exit(1);
  }
}
