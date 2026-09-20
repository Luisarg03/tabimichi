/**
 * ¿Acierta el recomendador? Benchmark contra un ranking de referencia.
 *
 *   node scripts/bench-accuracy.mjs [baseUrl] [--json]
 *
 * No existe verdad absoluta sobre "el mejor restaurante" — es personal. Lo que
 * SÍ se puede medir es si compartimos el criterio del ranking que el usuario
 * compara a mano: la prominencia de Google Maps para la misma consulta. Si
 * nuestro top se parece al suyo, elegimos como un humano elegiría; si no, hay
 * que justificar cada divergencia.
 *
 * TRES MÉTRICAS, de más a menos significativa:
 *
 *   quality@10   media del rating ponderado (bayesiano, misma fórmula que el
 *                ranking) de nuestro top 10, SOLO sobre los que tienen rating.
 *                Mide si lo que mostramos es bueno, sin importar el orden.
 *                Es la que menos depende del proxy.
 *   spearman     correlación de rangos vs la prominencia de Google, sobre los
 *                lugares que aparecen en AMBAS listas. 1 = mismo criterio,
 *                0 = independientes, negativo = criterio opuesto.
 *   p@10         cuántos de nuestros 10 primeros están en el top 10 de Google.
 *
 * La divergencia NO es automáticamente un error: nuestro score incluye hora,
 * clima, cercanía y variedad de cocina, cosas que Google no usa. Por eso se
 * reporta también el solapamiento con Radio/Reseñas, para poder atribuir la
 * diferencia a nuestro criterio y no a un ranking roto.
 *
 * Costo: 1 recommend por zona + 1-3 páginas de Nearby Search de Google (tu
 * key) por zona. Sin claves: solo la referencia de OSM (gratis).
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3000";
const WANT_JSON = process.argv.includes("--json");

// Zonas elegidas para cubrir denso/medio/residencial: un benchmark solo con
// Shibuya mide Shibuya, no el producto.
const ZONES = [
  { name: "Shinjuku", lat: 35.6909, lng: 139.7003 },
  { name: "Ueno", lat: 35.7141, lng: 139.7774 },
  { name: "Kamakura", lat: 35.3191, lng: 139.5504 },
  { name: "Nagano", lat: 36.6485, lng: 138.1949 },
  { name: "Kanazawa", lat: 36.5781, lng: 136.6481 },
  { name: "Hakata", lat: 33.5904, lng: 130.4207 },
  { name: "Sendai", lat: 38.2601, lng: 140.8820 },
  { name: "Naha", lat: 26.2124, lng: 127.6809 },
];

// Hora fija: el score depende de la hora, así que un benchmark sin anclar el
// reloj no es reproducible.
const NOW = "2026-05-20T12:00:00.000Z"; // 21:00 JST — cena, lo más comparable a Maps
const MODE = "walking";

const env = (() => {
  try {
    const out = {};
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return { ...out, ...process.env };
  } catch {
    return process.env;
  }
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Misma fórmula de calidad que usa el ranking, para no medir con otra vara. */
function weightedRating(rating, total) {
  if (rating === undefined || rating === null) return null;
  const n = Math.min(total ?? 0, 500);
  return n > 0 ? (rating * n + 3.9 * 15) / (n + 15) : rating;
}

function normalize(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, "");
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Spearman sobre rangos ya densos (1..n), con empates resueltos por promedio. */
function spearman(rankA, rankB) {
  const n = rankA.length;
  if (n < 3) return null;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ma = mean(rankA);
  const mb = mean(rankB);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = rankA[i] - ma;
    const y = rankB[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da === 0 || db === 0 ? null : num / Math.sqrt(da * db);
}

async function appTop(zone, token) {
  const res = await fetch(`${BASE}/api/recommend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      lat: zone.lat, lng: zone.lng, types: ["food"], mode: MODE, lang: "es", now: NOW,
    }),
  });
  if (!res.ok) throw new Error(`recommend ${res.status}`);
  const data = await res.json();
  return { places: data.places ?? [], sources: data.sources ?? [] };
}

/**
 * Prominencia de Google: Text Search por la MISMA intención que la app
 * ("local food restaurant"), que es el ranking que el usuario ve al buscar
 * comida en Maps. La primera versión usaba Nearby type=restaurant y traía
 * basura: las posiciones 1-2 de Shinjuku eran "Karaoke Pasela" y "Hotel
 * Listel" — con eso, ρ medía nuestra diferencia contra un ranking que incluye
 * karaokes, no contra un ranking de restaurantes.
 */
/**
 * Prominencia de Google, dos fuentes unidas (la app usa ambas, así que una
 * sola subrepresenta el solapamiento):
 *   - Nearby Search  → denso, orden por prominencia, respeta la ubicación
 *   - Text Search    → la MISMA consulta de intención que usa la app
 *
 * Sin filtro por `types`: Google etiqueta un karaoke con bar como "restaurant"
 * (medido: Karaoke Pasela salía 1º en Shinjuku y pasaba el filtro). El ruido
 * se deja, porque el usuario que busca en Maps también lo ve.
 *
 * Text Search ignora `location`/`strictbounds` en consultas que no matchean
 * nada en el país: "local food restaurant" para Shinjuku devolvió Clearwater,
 * Florida. Por eso el tope de distancia, que descarta otro continente.
 */
const MAX_REF_KM = 6;

async function googleReference(key, zone) {
  const out = [];
  const add = (r) => {
    const lat = r.geometry.location.lat;
    const lng = r.geometry.location.lng;
    if (haversineKm(zone, { lat, lng }) > MAX_REF_KM) return;
    out.push({ name: r.name, lat, lng, rating: r.rating, total: r.user_ratings_total, placeId: r.place_id });
  };

  let token = null;
  for (let page = 0; page < 3; page++) {
    const params = new URLSearchParams({
      location: `${zone.lat.toFixed(5)},${zone.lng.toFixed(5)}`,
      radius: "2500", type: "restaurant", language: "es", key,
    });
    if (token) params.set("pagetoken", token);
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`);
    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") break;
    for (const r of data.results ?? []) add(r);
    token = data.next_page_token;
    if (!token) break;
    await sleep(2200); // Google exige una pausa antes de que el token sea válido
  }

  const ts = await fetch(
    "https://maps.googleapis.com/maps/api/place/textsearch/json?" +
      new URLSearchParams({
        query: `local food restaurant near ${zone.lat.toFixed(4)},${zone.lng.toFixed(4)}`,
        location: `${zone.lat.toFixed(5)},${zone.lng.toFixed(5)}`,
        radius: "2500", strictbounds: "true", language: "es", key,
      })
  );
  const tsData = await ts.json();
  for (const r of tsData.results ?? []) add(r);

  const seen = new Set();
  return out.filter((p) => (seen.has(p.placeId) ? false : seen.add(p.placeId)));
}

/** ¿Es el mismo lugar? Google place_id exacto si lo tenemos cacheado, si no
 *  nombre normalizado dentro de 120 m (los OSM vienen a 40-100 m del centroide). */
function matchAppToRef(appPlace, ref, byName) {
  const exact = ref.find((r) => r.placeId && appPlace.id === `g_${r.placeId}`);
  if (exact) return exact;
  const key = normalize(appPlace.name);
  const candidates = byName.get(key) ?? [];
  return candidates.find((r) => haversineKm(appPlace, r) <= 0.12) ?? null;
}

async function run() {
  const key = env.GOOGLE_PLACES_API_KEY || env.GOOGLE_API_KEY;
  let token = null;
  const email = env.BENCH_EMAIL;
  const pass = env.BENCH_PASS;
  if (email && pass) {
    const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY;
    const res = await fetch(`${env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await res.json().catch(() => null);
    token = data?.access_token ?? null;
    console.log(token ? `sesión: ${email} (BYOK)` : "sin sesión: modo anónimo");
  } else {
    console.log("sin BENCH_EMAIL/BENCH_PASS: modo anónimo (sin Google)");
  }
  if (!key) console.log("⚠ sin GOOGLE_PLACES_API_KEY en el entorno: la referencia será solo OSM");

  const rows = [];
  for (const zone of ZONES) {
    process.stdout.write(`${zone.name.padEnd(10)} `);
    try {
      const { places, sources } = await appTop(zone, token);
      const ref = key ? await googleReference(key, zone) : [];
      const byName = new Map();
      for (const r of ref) {
        const k = normalize(r.name);
        byName.set(k, [...(byName.get(k) ?? []), r]);
      }

      const top10 = places.slice(0, 10);
      const rated = top10.map((p) => weightedRating(p.rating, p.userRatingsTotal)).filter((v) => v !== null);
      const quality = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;
      const ratedShare = rated.length / Math.max(1, top10.length);

      // rank compartido: nuestros top 30 vs la posición en la referencia
      const refIndex = new Map(ref.map((r, i) => [r, i]));
      const shared = [];
      places.forEach((p, i) => {
        const hit = matchAppToRef(p, ref, byName);
        if (hit) shared.push({ appRank: i + 1, refRank: refIndex.get(hit) + 1, hit });
      });
      const rho = spearman(shared.map((s) => s.appRank), shared.map((s) => s.refRank));

      const refTop10 = ref.slice(0, 10);
      const p10 = top10.filter((p) => refTop10.includes(matchAppToRef(p, ref, byName))).length;

      // OSM ya no se usa como referencia: los restaurantes de OpenStreetMap no
      // llevan rating (el tag `stars` existe pero está vacío en Japón —
      // verificado), así que "p@10 vs OSM" medía ruido y siempre daba 0/10.
      // La referencia de calidad sería otro proveedor (Tabelog), no OSM.

      const row = {
        zone: zone.name,
        appN: places.length,
        refN: ref.length,
        sources: sources.join("+"),
        quality,
        ratedShare,
        rho,
        sharedN: shared.length,
        p10,
        gradeable: shared.length >= 5, // con menos, un ρ es anecdótico
        free: rated.length === 0,
      };
      rows.push(row);
      console.log(
        `nuestros ${row.appN} | google ${row.refN} | compartidos ${row.sharedN} | ` +
        `ρ ${rho === null ? "n/a" : rho.toFixed(2)} | p@10 ${p10}/10 | ` +
        `calidad ${quality === null ? "sin ratings" : quality.toFixed(2)}`
      );
    } catch (e) {
      console.log(`ERROR ${String(e).slice(0, 80)}`);
      rows.push({ zone: zone.name, error: String(e) });
    }
    await sleep(300);
  }

  const ok = rows.filter((r) => !r.error);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const grad = ok.filter((r) => r.gradeable);
  const rhos = grad.map((r) => r.rho).filter((v) => v !== null);
  const summary = {
    zones: ok.length,
    gradeable: grad.length,
    meanShared: mean(ok.map((r) => r.sharedN)),
    // ρ solo sobre zonas con muestra suficiente: con 3 lugares compartidos un
    // ρ de -0.96 es ruido, no una conclusión.
    meanRho: mean(rhos),
    meanP10: mean(ok.map((r) => r.p10)),
    meanQuality: mean(ok.filter((r) => r.quality !== null).map((r) => r.quality)),
    ratedShare: mean(ok.map((r) => r.ratedShare)),
  };

  console.log("\n── resumen ──");
  console.log(`zonas medidas        : ${summary.zones}/${ZONES.length}`);
  console.log(`zonas evaluables     : ${summary.gradeable} (≥5 lugares compartidos)`);
  console.log(`compartidos por zona : ${summary.meanShared === null ? "n/a" : summary.meanShared.toFixed(1)}`);
  console.log(`spearman medio       : ${summary.meanRho === null ? "n/a" : summary.meanRho.toFixed(3)}  (1 = mismo criterio que Maps)`);
  console.log(`p@10 vs Google       : ${summary.meanP10 === null ? "n/a" : summary.meanP10.toFixed(1)}/10`);
  console.log(`calidad media top10  : ${summary.meanQuality === null ? "n/a" : summary.meanQuality.toFixed(3)}  (rating ponderado, 0-5)`);
  console.log(`cobertura de rating  : ${(summary.ratedShare * 100).toFixed(0)}% del top 10`);
  console.log("\nLeer con cuidado: el ρ sale de pocos lugares compartidos por zona, así");
  console.log("que es indicativo, no concluyente. La métrica sólida es calidad del top10");
  console.log("(no depende del matching) y p@10 (solapamiento con lo que muestra Maps).");

  mkdirSync("data/e2e-audit", { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  writeFileSync(`data/e2e-audit/bench-${stamp}.json`, JSON.stringify({ summary, rows }, null, 2));
  if (WANT_JSON) console.log(JSON.stringify({ summary, rows }, null, 2));
  else console.log(`\ndetalle: data/e2e-audit/bench-${stamp}.json`);
}

await run();
