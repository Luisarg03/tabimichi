/**
 * E2E Fase 3 — autenticado con keys reales (BYOK) contra server live.
 *   E2E_EMAIL=… E2E_PASS=… node scripts/e2e-phase3-keyed.mjs [baseUrl]
 * Creds por env: nunca hardcodear ni loguear valores de keys.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const { E2E_EMAIL, E2E_PASS } = process.env;
if (!E2E_EMAIL || !E2E_PASS) { console.error("FALTAN E2E_EMAIL/E2E_PASS"); process.exit(2); }
const SHOT = `data/e2e-audit/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
mkdirSync(SHOT, { recursive: true });

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  let recData = null;
  let recAuth = null;
  page.on("response", async (res) => {
    if (res.url().includes("/api/recommend") && res.request().method() === "POST") {
      try { recData = await res.json(); recAuth = res.request().headers()["authorization"] ?? null; } catch { /* no-json */ }
    }
  });

  // 1. login
  console.log("=== login ===");
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  await page.locator('input[type="email"]').fill(E2E_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_PASS);
  await page.locator('button[type="submit"]').click();
  await sleep(2500);
  check("sesión activa", await page.getByText(/Sesi[oó]n activa/i).first().isVisible().catch(() => false));
  const conn = await page.getByText("Conectado", { exact: true }).count();
  check("keys conectadas ≥3", conn >= 3, `count=${conn}`);
  await page.screenshot({ path: `${SHOT}/phase3-settings.png` });

  // 2. discover con keys en zona fresca (Takayama)
  console.log("=== discover keyed (Takayama) ===");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  const search = page.locator('input[placeholder*="Ciudad o lugar"]:visible');
  await search.first().fill("Takayama, Japón");
  await search.first().press("Enter");
  await sleep(2500);
  await page.locator('button:has-text("Descubrir"):visible').first().click();
  let cards = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    cards = await page.locator('[class*="card"], [class*="RecommendationCard"]').count().catch(() => 0);
    if (cards > 0) break;
  }
  check("cards con keys", cards > 0, `cards=${cards}`);
  check("JWT viaja en recommend", Boolean(recAuth?.startsWith("Bearer ")));
  const sources = recData?.sources ?? [recData?.sourceNote];
  check("merge con google", sources.includes("google"), `sources=${JSON.stringify(sources)}`);
  const hours = (recData?.places ?? []).filter((p) => p.openNow === true).length;
  check("horarios reales (algún open=true)", hours > 0, `open=${hours}`);
  await page.screenshot({ path: `${SHOT}/phase3-keyed.png` });

  // 3. fotos reales: la galería vive en el DETALLE (las cards son texto).
  // Abrir detalle y esperar blobs (primera vista descarga details + bytes).
  await page.locator('article[role="button"]').first().click().catch(() => {});
  await sleep(3000);
  let blobs = 0;
  for (let i = 0; i < 6; i++) {
    await sleep(5000);
    blobs = await page.locator('img[src^="blob:"]').count().catch(() => 0);
    if (blobs > 0) break;
  }
  check("fotos blob en galería", blobs > 0, `blobs=${blobs}`);

  // 4. keyword real (Google Text Search). kr es flaky en Google (2→0 en
  // repeticiones): se aserta que el keyword VIAJÓ, kr solo se loguea.
  console.log("=== keyword (soba) ===");
  const kw = page.locator('input[placeholder*="pokemon"]:visible');
  if ((await kw.count()) > 0) {
    await kw.first().fill("soba");
    await page.locator('button:has-text("Descubrir"):visible').first().click();
    await sleep(15000);
    check("keyword viaja al server", recData?.keyword === "soba", `kw=${recData?.keyword}`);
    console.log(`   (keywordResults=${recData?.keywordResults} — no determinista en Google)`);
    // limpiar: si no, los siguientes pools cambian
    await kw.first().fill("");
    await sleep(500);
  } else console.log("   (input de interés no visible)");

  // 5. guía Zen real
  console.log("=== guía ===");
  const guide = page.getByText("Preguntale al guía", { exact: true });
  if (await guide.first().isVisible().catch(() => false)) {
    await guide.first().click();
    let narrated = false;
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      narrated = await page.getByText("Regenerar resumen", { exact: false }).first().isVisible().catch(() => false);
      if (narrated) break;
    }
    check("guía narra (Regenerar visible)", narrated);
    await page.screenshot({ path: `${SHOT}/phase3-guide.png` });
  } else console.log("   (botón guía no visible)");

  // 6. reporte firmado → re-buscar → el MISMO id debe volver observed/mixed.
  // (Falla hasta corregir el read de crowd_reports: "URI too long".)
  console.log("=== reporte firmado ===");
  const allCards = page.locator('article[role="button"]');
  if ((await allCards.count()) > 0) {
    const cardText = await allCards.nth(3).innerText().catch(() => "?");
    const cardName = cardText.split("\n")[0].slice(0, 60);
    await allCards.nth(3).click();
    await sleep(2000);
    if (await page.getByText("¿Qué tan lleno está?", { exact: false }).first().isVisible().catch(() => false)) {
      await page.getByText("Lleno", { exact: true }).first().click();
      await sleep(1500);
      await page.locator('button:has-text("Descubrir"):visible').first().click();
      await sleep(12000);
      const pool = recData?.places ?? [];
      const reported = pool.find((p) => cardName.includes(p.name) || (cardName && p.name.includes(cardName.split(" ")[0])));
      if (reported) {
        check("reporte mezcla (observed/mixed)", reported.crowd?.source !== "model", `${reported.id} → ${reported.crowd?.source}`);
      } else console.log("   (place fuera del pool tras re-buscar)");
    }
  }

  // 7. voto 👍 → POST /api/feedback (el perfil se verifica vía API/logs)
  const likes = await page.getByLabel("Me gusta", { exact: false }).count().catch(() => 0);
  console.log(`   (botones Me gusta: ${likes})`);

  const uniq = [...new Set(errors)].filter((e) => !/GoTrueClient|Multiple/i.test(e));
  if (uniq.length === 0) check("cero console errors (keyed)", true);
  else { uniq.slice(0, 5).forEach((e) => console.log("   ❌", e.slice(0, 160))); check("cero console errors (keyed)", false, `${uniq.length}`); }

  await browser.close();
  console.log(`shots en ${SHOT}`);
  console.log(failures === 0 ? "\n✅ Fase 3 OK" : `\n❌ ${failures} falla(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
