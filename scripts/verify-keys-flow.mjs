/**
 * Targeted check for the "user keys never reached /api/recommend" fix.
 * Signs in as a user that has REAL provider keys saved, searches a NEW area
 * (cache miss) and verifies:
 *   - the browser sends Authorization: Bearer <JWT> on /api/recommend
 *   - the request completes (fast path via Google/Geoapify, not 30s Overpass)
 *   - no console errors (incl. the react-leaflet map crash)
 *
 * Usage: REPRO_EMAIL=… REPRO_PASS=… node scripts/verify-keys-flow.mjs [baseUrl]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const QUERY = process.env.QUERY ?? "Nara, Japón";

// Against a remote deployment, missing creds must not silently fall back to
// the localhost test account — ask for them interactively instead.
const isLocal = BASE.includes("localhost") || BASE.includes("127.0.0.1");
let EMAIL = process.env.REPRO_EMAIL ?? "repro-1787083799@tabimichi.test";
let PASSWORD = process.env.REPRO_PASS ?? "ReproPass1787083799!";
if (!isLocal && (!process.env.REPRO_EMAIL || !process.env.REPRO_PASS)) {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  EMAIL = await rl.question("Email de la cuenta en la app: ");
  PASSWORD = await rl.question("Contraseña: ");
  rl.close();
  if (!EMAIL || !PASSWORD) {
    console.error("email y password requeridos");
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES" });
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

let recommend = null;
page.on("request", (req) => {
  if (req.url().includes("/api/recommend")) {
    recommend = { auth: req.headers()["authorization"] ?? null, start: Date.now() };
  }
});
page.on("response", (res) => {
  if (res.url().includes("/api/recommend") && recommend && !recommend.status) {
    recommend.status = res.status();
    recommend.ms = Date.now() - recommend.start;
  }
});

// capture the sign-in call so a login failure shows GoTrue's exact answer
let loginResponse = null;
page.on("response", async (res) => {
  if (res.url().includes("/auth/v1/token") && !loginResponse) {
    loginResponse = { status: res.status(), body: (await res.text().catch(() => "")).slice(0, 200) };
  }
});

// 1. Login
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await sleep(1200);
await page.locator('input[type="email"]').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.locator('button[type="submit"]').click();
await sleep(2500);
const loggedIn = await page.getByText(/Sesi[oó]n activa/i).isVisible().catch(() => false);
console.log(`login: ${loggedIn ? "OK" : "FAIL"} (${EMAIL})`);
if (!loggedIn) {
  // self-diagnose: show the auth API's exact answer + any visible form text
  console.log("--- diagnóstico ---");
  if (loginResponse) console.log(`auth API: HTTP ${loginResponse.status} → ${loginResponse.body}`);
  const pageText = (await page.locator("body").innerText().catch(() => "")) || "";
  const lines = pageText.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 15);
  console.log(lines.length ? lines.join(" | ") : "(página sin texto visible)");
  await page.screenshot({ path: "/tmp/tabi-login-fail.png" });
  console.log("screenshot: /tmp/tabi-login-fail.png");
  await browser.close();
  process.exit(1);
}

// 2. Search a NEW area → Discover (cache miss → discovery chain runs)
await page.goto(BASE, { waitUntil: "networkidle" });
await sleep(1500);
const search = page.locator('input[placeholder*="Ciudad o lugar"]');
await search.fill(QUERY);
await search.press("Enter");
await sleep(2500);
const discoverBtn = page.getByText("Descubrir", { exact: true });
if (await discoverBtn.isVisible().catch(() => false)) await discoverBtn.click();
for (let i = 0; i < 60 && !(recommend && recommend.status); i++) await sleep(500);
await sleep(1500);

console.log(`recommend: auth=${recommend?.auth ? "Bearer …" + recommend.auth.slice(-8) : "SIN TOKEN"} status=${recommend?.status} ms=${recommend?.ms ?? "n/a"}`);
const cardCount = await page.locator('[class*="card"], [class*="RecommendationCard"]').count().catch(() => 0);
const resultsVisible = cardCount > 0 || (await page.getByText(/Abierto ahora|Cerrado ahora|km/i).first().isVisible().catch(() => false));
console.log(`results: cards=${cardCount} visible=${resultsVisible}`);

// BYOK photos: the cards must now render blob-URL images fetched with the
// user's own token (not transparent placeholders).
let blobImgs = 0;
for (let i = 0; i < 20 && blobImgs === 0; i++) {
  await sleep(500);
  blobImgs = await page.locator('img[src^="blob:"]').count().catch(() => 0);
}
console.log(`photos: blob imgs=${blobImgs}`);
await page.screenshot({ path: "/tmp/tabi-user-keys-flow.png" });
console.log(`console errors: ${errors.length ? [...new Set(errors)].slice(0, 5).join(" | ") : "none"}`);

await browser.close();
process.exit(recommend?.auth && recommend.status === 200 && resultsVisible && blobImgs > 0 && errors.length === 0 ? 0 : 1);
