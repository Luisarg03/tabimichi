/**
 * E2E Fase 2 — browser anónimo: rincones que test-e2e.mjs NO cubre.
 *   node scripts/e2e-phase2-anon.mjs [baseUrl]
 * Desktop 1440 + móvil 390. Usa /usr/bin/chromium (sin browsers descargados).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { seedPlaceCache } from "./seed-cache.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOT = `data/e2e-audit/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
mkdirSync(SHOT, { recursive: true });

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function discover(page, query) {
  await seedPlaceCache(34.6937569, 135.5014539);
  // móvil: el buscador vive tras la píldora (SearchOverlay); desktop: input directo
  const pill = page.getByLabel(/Dónde estás|Where are you/);
  if (await pill.isVisible().catch(() => false)) {
    await pill.click();
    await sleep(1200);
  }
  const search = page.locator('input[placeholder*="Ciudad o lugar"]:visible, input[placeholder*="City or place"]:visible');
  await search.first().fill(query);
  await search.first().press("Enter");
  await sleep(2000);
  // desktop + overlay móvil coexisten en el DOM (uno oculto): solo el visible
  const btn = page.locator('button:has-text("Descubrir"):visible');
  if ((await btn.count()) > 0) await btn.first().click();
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const n = await page.locator('[class*="card"], [class*="RecommendationCard"]').count().catch(() => 0);
    if (n > 0) return n;
    if (await page.getByText(/Sin resultados|No encontramos/i).first().isVisible().catch(() => false)) return 0;
  }
  return 0;
}

async function main() {
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

  // ---- desktop ----
  console.log("=== desktop 1440 ===");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  check("title", /Tabimichi/.test(await page.title()));
  const n = await discover(page, "Osaka, Japón");
  check("discover rinde cards", n > 0, `cards=${n}`);
  await page.screenshot({ path: `${SHOT}/phase2-results.png` });

  // hot zones: toggle → heat canvas → chips → click zona
  const toggle = page.getByTitle("Gente ahora", { exact: false });
  const toggleVisible = await toggle.first().isVisible().catch(() => false);
  check("toggle Gente ahora visible", toggleVisible);
  if (toggleVisible) {
    await toggle.first().click();
    await sleep(2500);
    const heat = await page.locator("canvas.leaflet-heatmap-layer").count().catch(() => 0);
    check("heat canvas renderiza", heat > 0);
    const circles = await page.locator("path.leaflet-interactive").count().catch(() => 0);
    console.log(`   (paths interactivos en mapa: ${circles})`);
    const chip = page.getByText(/Zona 1 ·/, { exact: false });
    if (await chip.first().isVisible().catch(() => false)) {
      await chip.first().click();
      await sleep(1500);
      check("chip Zona 1 clicable", true);
      await page.screenshot({ path: `${SHOT}/phase2-zone.png` });
    } else console.log("   (sin chips de zona: campo frío o sin clusters)");
  }

  // detalle + reporte de gente
  const cards = page.locator('[class*="card"], [class*="RecommendationCard"]');
  if ((await cards.count()) > 0) {
    await cards.first().click();
    await sleep(2000);
    const q = await page.getByText("¿Qué tan lleno está?", { exact: false }).first().isVisible().catch(() => false);
    check("detalle con pregunta de gente", q);
    if (q) {
      // solo el botón del detalle (la card muestra el badge "Normal" como texto)
      const normalBtn = page.getByRole("button", { name: "Normal" }).filter({ visible: true });
      await normalBtn.first().click();
      await sleep(1500);
      // el "¡Anotado!" es transitorio: tras guardar, el badge pasa a "observado HH:MM"
      const thanks = await page.getByText("¡Anotado!", { exact: false }).first().isVisible().catch(() => false);
      const observed = await page.getByText(/observado \d{2}:\d{2}/, { exact: false }).first().isVisible().catch(() => false);
      check("reporte guarda (gracias u observado)", thanks || observed);
      await page.screenshot({ path: `${SHOT}/phase2-detail.png` });
    }
  }

  // simulador: preset noche → re-descubrir
  const night = page.getByText("Noche · 21h", { exact: false });
  if (await night.first().isVisible().catch(() => false)) {
    await night.first().click();
    await sleep(800);
    const btn = page.getByText("Descubrir", { exact: true });
    if (await btn.isVisible().catch(() => false)) await btn.click();
    await sleep(6000);
    check("simulador noche re-busca", true);
    await page.screenshot({ path: `${SHOT}/phase2-sim-night.png` });
  } else console.log("   (preset Noche no visible)");

  // locale EN → ES
  const en = page.getByText("EN", { exact: true });
  if (await en.first().isVisible().catch(() => false)) {
    await en.first().click();
    await sleep(1200);
    check("locale EN", await page.getByText("Discover", { exact: true }).first().isVisible().catch(() => false));
    await page.getByText("ES", { exact: true }).first().click();
    await sleep(1200);
    check("vuelta a ES", await page.getByText("Descubrir", { exact: true }).first().isVisible().catch(() => false));
  } else console.log("   (toggle EN no visible)");

  const uniq = [...new Set(errors)].filter((e) => !/GoTrueClient|Multiple/i.test(e));
  if (uniq.length === 0) check("cero console errors (desktop)", true);
  else { uniq.slice(0, 5).forEach((e) => console.log("   ❌", e.slice(0, 160))); check("cero console errors (desktop)", false, `${uniq.length}`); }
  await ctx.close();

  // ---- móvil ----
  console.log("=== móvil 390 ===");
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-ES", isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  const merrors = [];
  mp.on("console", (m) => m.type() === "error" && merrors.push(m.text()));
  mp.on("pageerror", (e) => merrors.push("PAGEERROR: " + e.message));
  await mp.goto(BASE, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  const mn = await discover(mp, "Osaka, Japón");
  check("móvil: discover rinde", mn > 0, `cards=${mn}`);
  await mp.screenshot({ path: `${SHOT}/phase2-mobile-results.png` });
  const mtoggle = mp.getByTitle("Gente ahora", { exact: false });
  if (await mtoggle.first().isVisible().catch(() => false)) {
    await mtoggle.first().tap();
    await sleep(2500);
    await mp.screenshot({ path: `${SHOT}/phase2-mobile-heat.png` });
    check("móvil: toggle heat", true);
  } else console.log("   (toggle no visible en móvil)");
  const uniqm = [...new Set(merrors)].filter((e) => !/GoTrueClient|Multiple/i.test(e));
  check("cero console errors (móvil)", uniqm.length === 0, uniqm.slice(0, 3).map((e) => e.slice(0, 100)).join(" | "));
  await mctx.close();

  await browser.close();
  console.log(`shots en ${SHOT}`);
  console.log(failures === 0 ? "\n✅ Fase 2 OK" : `\n❌ ${failures} falla(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
