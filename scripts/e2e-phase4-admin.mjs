/** Fase 4: admin console + borrado de cuenta + errores full.
 *  DESTRUCTIVO: borra la cuenta con la que corre. Nunca apuntarlo a la cuenta
 *  persistente de data/TEST-ACCOUNT.md — usar un usuario descartable. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const { E2E_EMAIL, E2E_PASS } = process.env;
if (!E2E_EMAIL || !E2E_PASS) {
  console.error("FALTAN E2E_EMAIL/E2E_PASS (usuario DESCARTABLE, no el persistente)");
  process.exit(2);
}

// guard: la cuenta de pruebas persistente no se borra desde acá
try {
  const note = readFileSync("data/TEST-ACCOUNT.md", "utf8");
  const protectedEmail = /`([^`]+@tabimichi\.test)`/.exec(note)?.[1];
  if (protectedEmail && E2E_EMAIL === protectedEmail) {
    console.error(`✗ E2E_EMAIL apunta a la cuenta persistente (${protectedEmail}).`);
    console.error("  Este script la borraría. Usá un usuario descartable.");
    process.exit(2);
  }
} catch {
  // sin nota local → nada que proteger
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES" });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR-FULL:", m.text()); });
page.on("pageerror", (e) => console.log("PAGEERROR-FULL:", e.message));

await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await sleep(1500);
await page.locator('input[type="email"]').fill(E2E_EMAIL);
await page.locator('input[type="password"]').fill(E2E_PASS);
await page.locator('button[type="submit"]').click();
await sleep(2500);

// admin
console.log("=== admin ===");
await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
await sleep(2500);
const body = await page.innerText("body").catch(() => "");
check("admin visible (usuarios o panel)", /usuari|admin|e2e-/i.test(body), body.slice(0, 100));
await page.screenshot({ path: "data/e2e-audit/phase4-admin.png" });

// borrado de cuenta (último: destruye el usuario)
console.log("=== account delete ===");
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await sleep(1500);
const delBtn = page.getByText("Eliminar mi cuenta", { exact: true });
if (await delBtn.first().isVisible().catch(() => false)) {
  await delBtn.first().scrollIntoViewIfNeeded().catch(() => {});
  await delBtn.first().click();
  await sleep(1200);
  // pide escribir ELIMINAR para confirmar
  const confirmInput = page.locator('input[placeholder*="ELIMINAR"]').first();
  if (await confirmInput.isVisible().catch(() => false)) {
    await confirmInput.fill("ELIMINAR");
    await sleep(500);
  }
  const confirmBtn = page.getByText("Eliminar mi cuenta", { exact: true }).last();
  await confirmBtn.click().catch(() => {});
  await sleep(3000);
  const after = await page.innerText("body").catch(() => "");
  check("cuenta eliminada (mensaje o auth form)", /eliminada|Hasta pronto|Iniciar sesión/i.test(after), JSON.stringify(after.slice(0, 120)));
  await page.screenshot({ path: "data/e2e-audit/phase4-deleted.png" });
} else check("botón de borrado visible", false);

await browser.close();
console.log(failures === 0 ? "✅ Fase 4 UI OK" : `❌ ${failures} falla(s)`);
