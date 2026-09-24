/**
 * Guard for the one failure mode that is invisible at runtime: dotenv quietly
 * ends an unquoted value at the first `#` and trims surrounding whitespace, so
 * a vault note can load a truncated secret and nothing complains.
 *
 * The parser below is dotenv 16.3.1's, copied verbatim from the copy bundled
 * inside `@next/env` — the exact code Next runs when it loads `.env.local`.
 * That is the whole point: the renderer is only correct if its output survives
 * *that* parser unaltered.
 *
 * Run: node --test scripts/secrets.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, isAbbreviationOf, editDistance } from "./secrets.mjs";

const HERE = import.meta.dirname;

const DOTENV_LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

function parseDotenv(text) {
  const out = {};
  const body = text.toString().replace(/\r\n?/gm, "\n");
  let match;
  while ((match = DOTENV_LINE.exec(body)) != null) {
    let value = (match[2] || "").trim();
    const quote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, "$2");
    if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    out[match[1]] = value;
  }
  return out;
}

/** What the note says, read the naive way a human reads it. */
function expectedFrom(note) {
  const out = {};
  for (const line of note.trim().split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const [, key, raw] = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/);
    const value = /^(["'`])[\s\S]*\1$/.test(raw) ? raw.slice(1, -1) : raw.trim();
    out[key] = value;
  }
  return out;
}

/** The real assertion: write a note, then load it the way Next would. */
const survives = (note) => {
  const { text } = render(note);
  assert.deepEqual(parseDotenv(text), expectedFrom(note), `rendered:\n${text}`);
};

test("a hash inside a value is not a comment", () => {
  survives('A="valor#sin_espacio"');
  survives('B="abc # nota"');
});

test("an unquoted hash is refused rather than silently truncated", () => {
  // This is the trap: dotenv would load "svc" and say nothing.
  assert.throws(() => render("SUPABASE_SERVICE_ROLE_KEY=svc#con-hash"), /unquoted #/);
  assert.throws(() => render("A=abc # nota"), /unquoted #/);
  // Quoted, the same value is exact.
  survives('SUPABASE_SERVICE_ROLE_KEY="eyJ.svc#con-hash"');
});

test("surrounding whitespace is refused, not silently trimmed", () => {
  // dotenv would load "con espacios" and say nothing about the rest.
  assert.throws(() => render("PASS=  con espacios  "), /surrounding whitespace/);
  survives('PASS="  con espacios  "');
});

test("quotes, JWTs and sb_ keys survive", () => {
  survives('A="abc # nota"');
  survives("A=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-def_123");
  survives("A=sb_secret_AbCdEf123_xYz");
});

test("one kind of quote inside a value survives", () => {
  survives('A=pa"ss');
  survives("A=pa'ss");
});

test("keys may contain dots and dashes", () => {
  survives("A.B=1\nMY-KEY=2");
});

test("urls survive, with or without a fragment", () => {
  survives("A=https://x.supabase.co/auth/v1?apikey=abc");
  survives('A="https://x.supabase.co/auth/v1?apikey=a#frag"');
});

test("a malformed line is refused, because dotenv would ignore it", () => {
  assert.throws(() => render("A=1\nesto no es env\nB=2"), /dotenv would ignore it/);
  assert.throws(() => render("=1"), /not KEY=value/);
});

test("empty, duplicate and unquotable values are refused", () => {
  assert.throws(() => render("A="), /empty value/);
  assert.throws(() => render("A=1\nA=2"), /defined twice/);
  assert.throws(() => render("# only comments"), /no KEY=value/);
  assert.throws(() => render(`A=pa"ss'quoted`), /cannot quote it safely/);
});

/** A Supabase-shaped JWT with the given role claim. */
function supabaseJwt(role) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", role })}.signature`;
}

test("the anon key is allowed in NEXT_PUBLIC_: it is meant to be public", () => {
  // RLS protects the data, not the secrecy of this key. Blocking it would make
  // the correct configuration impossible — this test exists because an earlier
  // length-based check rejected the real .env.local.
  survives(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${supabaseJwt("anon")}`);
  survives("NEXT_PUBLIC_SUPABASE_URL=https://" + "x".repeat(80) + ".supabase.co");
});

test("a service_role key in a NEXT_PUBLIC_ var is refused", () => {
  // The genuinely catastrophic one: service_role bypasses RLS entirely.
  assert.throws(
    () => render(`NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=${supabaseJwt("service_role")}`),
    /bypasses RLS/,
  );
  // Same key under a private name is fine — that is where it belongs.
  survives(`SUPABASE_SERVICE_ROLE_KEY=${supabaseJwt("service_role")}`);
});

test("new-style secret keys in a NEXT_PUBLIC_ var are refused", () => {
  assert.throws(() => render("NEXT_PUBLIC_SUPABASE_KEY=sb_secret_abc123"), /private key/);
  assert.throws(() => render("NEXT_PUBLIC_STRIPE=sk_live_abc123"), /private key/);
  // ...and are fine server-side.
  survives("SUPABASE_SERVICE_ROLE_KEY=sb_secret_abc123");
});

/**
 * The reader (secrets.mjs) and the writer (secrets-notes.sh) each carry the
 * environment → note-name mapping, and nothing at runtime connects them: the
 * writer creates "Tabi dev (local)" while the reader asks for "Tabi local", and
 * the only symptom is "no vault item named …" after the note plainly exists.
 * That already happened once. This is the guard.
 */
test("both scripts agree on the vault note names", () => {
  const reader = readFileSync(path.join(HERE, "secrets.mjs"), "utf8");
  const block = reader.match(/const ENVS = \{([\s\S]*?)\};/);
  assert.ok(block, "secrets.mjs no longer declares a literal ENVS map");
  const readNames = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

  const writer = readFileSync(path.join(HERE, "secrets-notes.sh"), "utf8");
  // `upsert` only: `admin_upsert "Tabi admin"` is deliberately NOT an .env file,
  // so the reader must not know about it.
  const writeNames = [...writer.matchAll(/(?<!admin_)upsert "(Tabi[^"]+)"/g)]
    .map((m) => m[1])
    .sort();

  assert.deepEqual(
    readNames,
    writeNames,
    "secrets.mjs and secrets-notes.sh disagree about the note names",
  );
  assert.equal(readNames.length, 3, "expected exactly three environment notes");
});

/**
 * The "did you mean" hint exists because a rename in Bitwarden is invisible to
 * every other check: `Tabi prod` vs `Tabi production` cost a full round trip to
 * diagnose. A wrong suggestion is worse than none — it sends you to rename the
 * wrong note — so the negative cases carry the weight here.
 */
test("the near-miss hint connects an abbreviation, not a sibling", () => {
  // "prod" abbreviates "production"...
  assert.ok(isAbbreviationOf("Tabi prod", "Tabi production"));
  // ...but nothing else in the vault does.
  assert.ok(!isAbbreviationOf("Tabi sandbox", "Tabi production"));
  assert.ok(!isAbbreviationOf("Tabi dev (local)", "Tabi production"));
  assert.ok(!isAbbreviationOf("Token-AccountTabiSandbox", "Tabi production"));
  assert.ok(!isAbbreviationOf("vercel.com", "Tabi production"));
  // A different project's prod is not this project's production.
  assert.ok(!isAbbreviationOf("Other Project prod", "Tabi production"));
  // Too short to be an abbreviation rather than a typo in progress.
  assert.ok(!isAbbreviationOf("Tabi pr", "Tabi production"));
  // A bare prefix is not it either: with four "Tabi …" notes in the vault,
  // suggesting one of them would be picking at random.
  assert.ok(!isAbbreviationOf("Tabi", "Tabi production"));
});

test("Levenshtein catches typos but not an abbreviation", () => {
  const want = "Tabi production";
  const close = (n) => editDistance(n.toLowerCase(), want.toLowerCase()) <= 2;
  assert.ok(close("Tabi producion")); // missing t
  assert.ok(close("Tabi prodution")); // missing c
  // The abbreviation is 6 edits away — which is exactly why it needs its own
  // rule instead of a looser distance threshold that would drag in siblings.
  assert.ok(!close("Tabi prod"));
  assert.ok(!close("Tabi sandbox"));
});
