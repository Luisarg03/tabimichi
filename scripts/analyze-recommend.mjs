#!/usr/bin/env node
/**
 * Quality analyzer for recommendations.
 *
 * Runs a scenario matrix against a LIVE server and prints a compact quality
 * report per scenario: candidate pool, filter breakdown, top-10, and metrics
 * (avg rating, chains/hotels in the top, type diversity, avg travel, keyword
 * hits). Use it to evaluate how well the recommendation engine performs and
 * to spot regressions after scoring changes.
 *
 * Usage:  npm start (server on :3000)  →  node scripts/analyze-recommend.mjs
 * Options: BASE (env) to point at another server, e.g. BASE=http://localhost:3100
 */
const BASE = process.env.BASE ?? "http://localhost:3000";

const CHAIN_RE =
  /mcdonald|マクドナルド|sukiya|すき家|matsuya|松屋|yoshinoya|吉野家|gusto|ガスト|royal host|kfc|mos burger|スターバックス|doutor|ドトール|saizeriya|サイゼリヤ|coco ichibanya|bikkuri donkey|joyfull|denny|デニーズ|hidakaya|日高屋|pepper lunch|first kitchen|lotteria|kura sushi|くら寿司|sushiro|スシロー|hamazushi|はま寿司|kappazushi|かっぱ寿司|ootoya|大戸屋|yayoiken|やよい軒|torikizoku|鳥貴族/i;
const HOTEL_RE = /hotel|ホテル|旅館|ryokan/i;

const SCENARIOS = [
  { name: "Tokyo Station", lat: 35.681619, lng: 139.7653303 },
  { name: "Osaka Umeda", lat: 34.7048, lng: 135.4944 },
  { name: "Nagano", lat: 36.6485, lng: 138.1949 },
];
const KEYWORDS = [undefined, "pokemon", "gatos", "book off"];

async function post(body) {
  const res = await fetch(`${BASE}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function reasonsOf(p) {
  return (p.reasons ?? []).map((r) => r.key).join(",");
}

async function runScenario(sc) {
  const { name, lat, lng, keyword } = sc;
  const body = { lat, lng, budget: "afternoon", types: [], mode: "transit", lang: "es" };
  if (keyword) body.keyword = keyword;
  const r = await post(body);
  const places = r.places ?? [];

  const ratings = places.map((p) => p.rating).filter((x) => x !== undefined);
  const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : "-";
  const chains = places.filter((p) => CHAIN_RE.test(p.name ?? "")).length;
  const hotels = places.filter((p) => HOTEL_RE.test(p.name ?? "")).length;
  const types = new Set(places.flatMap((p) => p.tags ?? [])).size;
  const avgTravel = places.length
    ? Math.round(places.reduce((a, p) => a + (p.travelMin ?? 0), 0) / places.length)
    : 0;
  const kwHits = (r.filters?.nameMatches ?? 0) === 0 && keyword
    ? places.filter((p) => (p.reasons ?? []).some((x) => x.key === "keywordMatch")).length
    : (r.filters?.nameMatches ?? 0);

  const miss = r.keywordMiss ? " ⚠ KEYWORD MISS (pool genérico)" : "";
  console.log(`\n=== ${name} ${keyword ? `· kw:"${keyword}"` : "· sin keyword"} — ${r.sourceNote}, ${places.length} resultados, empty:${r.emptyReason ?? "-"}${miss} ===`);
  if (r.filters) console.log(`filters: closed=${r.filters.closed} tooFar=${r.filters.tooFar} nameMatches=${kwHits} kwResults=${r.keywordResults ?? 0}`);
  for (const p of places.slice(0, 10)) {
    console.log(
      `  ${String(p.score).padStart(3)} ${(p.name ?? "").slice(0, 42).padEnd(42)} ${String(p.distanceKm ?? 0).padStart(4)}km ⭐${p.rating ?? "-"} [${reasonsOf(p).slice(0, 60)}]`
    );
  }
  console.log(
    `metrics: avgRating=${avgRating} chains=${chains} hotels=${hotels} types=${types}/5 avgTravel=${avgTravel}min`
  );
  return { avgRating: Number(avgRating), chains, hotels, types, kwHits, scored: places.length };
}

const results = [];
for (const loc of SCENARIOS) {
  for (const keyword of KEYWORDS) {
    try {
      results.push(await runScenario({ ...loc, keyword }));
    } catch (e) {
      console.log(`\n=== ${loc.name} ${keyword ?? ""} → ERROR ${e.message}`);
    }
  }
}

const scored = results.filter((r) => r.scored > 0);
const good = scored.filter((r) => r.chains + r.hotels === 0 && r.avgRating >= 4);
console.log(`\n--- resumen: ${good.length}/${scored.length} escenarios con top-10 sin cadenas/hoteles y rating promedio ≥ 4.0 ---`);
