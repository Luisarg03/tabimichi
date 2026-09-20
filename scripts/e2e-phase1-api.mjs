/**
 * E2E Fase 1 — API + anónimo contra server live.
 *   node scripts/e2e-phase1-api.mjs [baseUrl]
 * Sin auth: verifica forma, códigos 401/403/404/405 y degradación keyless.
 * Pacing entre recommends (15/IP) para no tripear 429.
 */
const BASE = process.argv[2] ?? "http://localhost:3000";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, res, json: await res.json().catch(() => null) };
}
async function post(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, res, json: await res.json().catch(() => null) };
}

async function main() {
  console.log(`Fase 1 API contra ${BASE}`);

  console.log("home:");
  { const r = await fetch(BASE); check("GET / 200", r.status === 200, `status ${r.status}`); }

  console.log("recommend (real, Osaka):");
  let r = await post("/api/recommend", { lat: 34.6937, lng: 135.5023, budget: "afternoon", types: [], mode: "walking", lang: "es" });
  check("200", r.status === 200, `status ${r.status}`);
  check("places > 0", (r.json?.places ?? []).length > 0, `n=${(r.json?.places ?? []).length}`);
  check("crowd en todos", (r.json?.places ?? []).every((p) => p.crowd && p.crowd.level >= 0 && p.crowd.level <= 1));
  check("crowdCells presente", Array.isArray(r.json?.crowdCells));
  const hz = r.json?.hotZones ?? [];
  check("hotZones forma válida", hz.every((z) => z.radiusM >= 150 && z.radiusM <= 600 && z.weight >= 0 && z.weight <= 1 && (z.placeIds ?? []).length <= 8), `n=${hz.length}`);
  check("traceId", /^tr_/.test(r.json?.traceId ?? ""));

  await sleep(5000); // pacing (15/IP)

  console.log("recommend (simulado 03:00):");
  r = await post("/api/recommend", { lat: 34.6937, lng: 135.5023, budget: "afternoon", types: ["food"], mode: "walking", lang: "es", now: "2026-08-16T03:00:00.000Z" });
  check("200", r.status === 200, `status ${r.status}`);
  check("simulados nunca closed", (r.json?.places ?? []).every((p) => p.openNow !== false));

  console.log("crowd/report:");
  r = await post("/api/crowd/report", { placeId: "e2e-place-1", level: 2, lat: 34.69, lng: 135.5 });
  check("report anónimo 200 (local)", r.status === 200, `status ${r.status} ${JSON.stringify(r.json)}`);
  r = await post("/api/crowd/report", { placeId: "x", level: 9 });
  check("level 9 → 400", r.status === 400, `status ${r.status}`);
  r = await post("/api/crowd/report", { level: 1 });
  check("sin placeId → 400", r.status === 400, `status ${r.status}`);
  { const res = await fetch(`${BASE}/api/crowd/report`); check("GET → 405", res.status === 405, `status ${res.status}`); }

  console.log("search/geocode/weather:");
  r = await get("/api/search/suggest?q=Osaka&lang=es&limit=5");
  check("suggest 200", r.status === 200, `status ${r.status}`);
  r = await get("/api/geocode?q=Nara%2C%20Jap%C3%B3n");
  check("geocode 200", r.status === 200, `status ${r.status}`);
  // nota: /api/weather no existe como ruta (el clima es lib interna vía open-meteo)

  console.log("auth-gated sin token:");
  r = await get("/api/admin/users");
  check("admin/users → 401/403", r.status === 401 || r.status === 403, `status ${r.status}`);
  r = await get("/api/logs?tail=5");
  check("logs → 401/403", r.status === 401 || r.status === 403, `status ${r.status}`);
  r = await post("/api/account/delete", {});
  check("account/delete → 401", r.status === 401, `status ${r.status}`);
  r = await get("/api/me");
  console.log(`   (me anónimo: status ${r.status})`);

  console.log("photos sin key:");
  r = await get("/api/photo?ref=bogus&id=e2e");
  check("photo bogus → 200 (GIF, nunca error)", r.status === 200, `status ${r.status}`);

  console.log("rutas inexistentes:");
  { const res = await fetch(`${BASE}/api/nope`, { method: "POST" }); check("POST /api/nope → 404", res.status === 404, `status ${res.status}`); }

  console.log(failures === 0 ? "\n✅ Fase 1 OK" : `\n❌ ${failures} falla(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
