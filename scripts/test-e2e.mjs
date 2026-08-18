/**
 * E2E browser test — full user flow against a LIVE Tabi server:
 *   1. Visit homepage
 *   2. Settings → auth form (unauthenticated)
 *   3. Register a new user (Supabase Local, email confirmations ON)
 *   4. Confirm the email via inbucket (local SMTP sink)
 *   5. Sign out → login again
 *   6. Save API keys per-user → verify they persist
 *   7. Homepage → search a city → discover places
 *
 * Requires: server running on :3000, Supabase Local up, inbucket on :54324.
 *   node scripts/test-e2e.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { seedPlaceCache } from "./seed-cache.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const INBUCKET = "http://localhost:54324";
const EMAIL = `test-${Date.now()}@tabimichi.test`;
const MAILBOX = EMAIL.split("@")[0];
const PASSWORD = "Test1234!";

const TEST_KEYS = {
  google: "AIzaSyTestKey00000000000000000000",
  geoapify: "geo-test-12345678",
  zen: "sk-zen-test-123",
  go: "sk-go-test-456",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function confirmEmail(page) {
  // Poll inbucket until the confirmation email arrives, then open its link.
  let link = null;
  for (let i = 0; i < 15 && !link; i++) {
    await sleep(2000);
    const res = await fetch(`${INBUCKET}/api/v1/mailbox/${MAILBOX}`).catch(() => null);
    if (!res || !res.ok) continue;
    const msgs = await res.json().catch(() => []);
    const html = msgs?.[0]?.body?.html ?? "";
    const text = msgs?.[0]?.body?.text ?? "";
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    link =
      hrefs.find((h) => h.includes("token_hash") || h.includes("access_token")) ??
      hrefs.find((h) => h.includes("127.0.0.1") || h.includes("localhost"));
    if (!link && text) {
      const m = text.match(/https?:\/\/\S+/);
      if (m && (m[0].includes("token_hash") || m[0].includes("access_token"))) link = m[0];
    }
  }
  check("confirmation email + link found", Boolean(link), "inbucket mailbox " + MAILBOX);
  if (!link) return false;
  await page.goto(link, { waitUntil: "domcontentloaded" });
  await sleep(2500); // let supabase-js exchange the token
  return true;
}

async function main() {
  console.log(`Browser E2E against ${BASE} (user: ${EMAIL})`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES" });
  const page = await ctx.newPage();

  const errors = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  page.on("pageerror", (err) => errors.push(err.message));

  // 1. Homepage
  console.log("=== 1. Homepage ===");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(1500);
  const title = await page.title();
  check("title ok", /Tabimichi/.test(title), title);
  await page.screenshot({ path: "/tmp/tabi-01-home.png" });

  // 2. Settings (unauthenticated) → auth form
  console.log("=== 2. Settings (unauthenticated) ===");
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await sleep(1200);
  const loginVisible = await page.getByText("Iniciar sesión", { exact: false }).first().isVisible().catch(() => false);
  const registerLink = await page.getByText("Crear una", { exact: false }).isVisible().catch(() => false);
  check("auth form visible", loginVisible);
  check("register link visible", registerLink);
  await page.screenshot({ path: "/tmp/tabi-02-settings-unauth.png" });

  // 3. Register
  console.log("=== 3. Register ===");
  if (registerLink) {
    await page.getByText("Crear una", { exact: false }).click();
    await sleep(500);
  }
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await sleep(3000);
  const confirmPrompt = await page
    .getByText(/Cuenta creada|Revis.*email/i)
    .first()
    .isVisible()
    .catch(() => false);
  console.log(`   (after submit: ${confirmPrompt ? "confirm-email prompt" : "no prompt"})`);
  await page.screenshot({ path: "/tmp/tabi-03-register.png" });

  // 4. Session after register — either auto-logged-in (local GoTrue returns a
  //    session without email) or confirmed via inbucket (confirmations on)
  console.log("=== 4. Confirm email / session ===");
  let sessionActive = false;
  if (!confirmPrompt) {
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    await sleep(1500);
    sessionActive = await page.getByText(/Sesi[oó]n activa/i).isVisible().catch(() => false);
    check("auto-login after signup", sessionActive);
  } else {
    const confirmed = await confirmEmail(page);
    check("confirmation email + link found", confirmed, "inbucket mailbox " + MAILBOX);
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    await sleep(1500);
    sessionActive = await page.getByText(/Sesi[oó]n activa/i).isVisible().catch(() => false);
    check("session active after confirmation", confirmed && sessionActive);
  }
  await page.screenshot({ path: "/tmp/tabi-04-confirmed.png" });

  // 5. Sign out → login
  console.log("=== 5. Sign out → login ===");
  const signOut = page.getByText("Cerrar sesión", { exact: false });
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click();
    await sleep(1500);
  }
  const backToAuth = await page.getByText("Iniciar sesión", { exact: false }).first().isVisible().catch(() => false);
  check("signed out (auth form back)", backToAuth);
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await sleep(2500);
  const loggedIn = await page.getByText(/Sesi[oó]n activa/i).isVisible().catch(() => false);
  check("login works", loggedIn);
  await page.screenshot({ path: "/tmp/tabi-05-loggedin.png" });

  // 6. Save per-user API keys
  console.log("=== 6. Save API keys ===");
  if (loggedIn) {
    await page.locator('input[placeholder="AIza…"]').fill(TEST_KEYS.google);
    await page.locator('input[placeholder="API key (geoapify.com)"]').fill(TEST_KEYS.geoapify);
    const skInputs = page.locator('input[placeholder="sk-…"]');
    await skInputs.nth(0).fill(TEST_KEYS.zen);
    await skInputs.nth(1).fill(TEST_KEYS.go);
    await page.getByText("Guardar", { exact: true }).click();
    await sleep(2000);
    const saved = await page.getByText("Guardado", { exact: false }).first().isVisible().catch(() => false);
    check("keys saved", saved);
    await page.screenshot({ path: "/tmp/tabi-06-keys-saved.png" });

    // reload → keys must still be there (persisted in Supabase per-user)
    await page.reload({ waitUntil: "networkidle" });
    await sleep(1500);
    const connected = await page.getByText("Conectado", { exact: true }).count();
    check("keys persisted (reload shows Conectado ×4)", connected >= 4, `count=${connected}`);
    await page.screenshot({ path: "/tmp/tabi-07-keys-persisted.png" });
  }

  // 7. Homepage → search → discover
  console.log("=== 7. Search + discover ===");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(1500);
  // Deterministic discovery: seed the shared cache around Osaka center so the
  // result step never depends on live Google/Geoapify/Overpass.
  await seedPlaceCache(34.6937569, 135.5014539);
  const search = page.locator('input[placeholder*="Ciudad o lugar"]');
  await search.fill("Osaka, Japón");
  await search.press("Enter");
  await sleep(2000);
  const discoverBtn = page.getByText("Descubrir", { exact: true });
  const canDiscover = await discoverBtn.isVisible().catch(() => false);
  if (canDiscover) await discoverBtn.click();
  // Poll for results: the E2E user's keys are placeholders, so discovery falls
  // through Google→Geoapify→Overpass (up to its ~30s budget) on a cache miss —
  // a fixed sleep would flake whenever the local cache is cold.
  let resultsVisible = false;
  let cardCount = 0;
  for (let i = 0; i < 50 && !resultsVisible; i++) {
    await sleep(1000);
    cardCount = await page.locator('[class*="card"], [class*="RecommendationCard"]').count().catch(() => 0);
    resultsVisible =
      cardCount > 0 ||
      (await page.getByText(/Abierto ahora|Cerrado ahora|km/i).first().isVisible().catch(() => false));
  }
  check("discover produced results", resultsVisible, `cards=${cardCount}`);
  await page.screenshot({ path: "/tmp/tabi-08-results.png" });

  // 8. Console errors
  console.log("=== 8. Console errors ===");
  if (errors.length === 0) {
    check("no console errors", true);
  } else {
    [...new Set(errors)].slice(0, 5).forEach((e) => console.log("   ❌", e.slice(0, 160)));
    check("no console errors", false, `${errors.length} error(s)`);
  }

  await browser.close();
  console.log(failures === 0 ? "\n✅ Browser E2E passed" : `\n❌ ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
