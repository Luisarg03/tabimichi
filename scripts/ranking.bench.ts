/**
 * ¿Elige bien el ranking? Medición sobre el MISMO universo de candidatos.
 *
 *   pnpm bench:ranking        (necesita la app corriendo en :3000)
 *
 * Por qué existe esta versión y no alcanza `bench-accuracy.mjs`: aquel
 * intersectaba nuestra lista con la de Google y medía ρ sobre la intersección
 * — 3 a 15 lugares, donde un ρ es anecdótico, y encima mezclaba dos problemas
 * distintos: qué lugares descubrimos y cómo los ordenamos.
 *
 * Acá se elimina el discovery y el matching de la ecuación. El universo es el
 * POOL REAL de la app (pedido con `poolLimit` para saltar el corte de 30 de la
 * UI), y se comparan dos órdenes sobre exactamente los mismos lugares:
 *
 *   - el nuestro        (el score de la app: cercanía, rating, hora, clima…)
 *   - el de referencia  (rating ponderado por volumen, que es como juzga una
 *                        persona mirando estrellas y cantidad de reseñas)
 *
 * `recall@10` responde entonces limpio: "de los 10 mejores de la zona, ¿cuántos
 * muestra la app?". No depende de matching ni de OSM.
 *
 * Usar el pool de la app y no un Nearby crudo es deliberado: el primer intento
 * de este bench rankeaba karaokes y hoteles porque Google los tipa como
 * "restaurant" y el benchmark no aplicaba los filtros de la app. Medía un
 * producto que no existe.
 *
 * Lo que NO mide: si el pool es completo (Google Nearby es una muestra por
 * prominencia; en Kanazawa el pool tenía 32 lugares de Google y 269 en total).
 * Eso es cobertura de discovery, un problema distinto y anotado aparte.
 */
import { describe, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import type { Place } from "@/lib/types";

const BASE = process.env.BENCH_BASE ?? "http://localhost:3000";
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

/** Hora fija: el score depende de la hora, un bench sin reloj no es repetible. */
const NOW = "2026-05-20T12:00:00.000Z"; // 21:00 JST — cena
const MODE = "walking";
const POOL = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** El pool real de la app, ya filtrado y ordenado por su propio score. */
async function appPool(zone: { lat: number; lng: number }): Promise<Place[]> {
  const res = await fetch(`${BASE}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lat: zone.lat, lng: zone.lng, types: ["food"], mode: MODE, lang: "es",
      now: NOW, poolLimit: POOL,
    }),
  });
  if (!res.ok) throw new Error(`recommend ${res.status}`);
  const data = (await res.json()) as { places: Place[] };
  return data.places ?? [];
}

/** Referencia: rating ponderado por volumen. El criterio de una persona que
 *  mira Google Maps y ordena por "estrellas con muchas reseñas". Se exige un
 *  mínimo de reseñas para que un 5.0 con 4 opiniones no lidere. */
function referenceOrder(places: Place[]): Place[] {
  const weighted = (p: Place) => {
    const n = Math.min(p.userRatingsTotal ?? 0, 500);
    return n > 0 ? ((p.rating ?? 0) * n + 3.9 * 15) / (n + 15) : (p.rating ?? 0);
  };
  return [...places]
    .filter((p) => (p.userRatingsTotal ?? 0) >= 30)
    .sort((a, b) => weighted(b) - weighted(a) || (b.userRatingsTotal ?? 0) - (a.userRatingsTotal ?? 0));
}

function spearman(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 3) return null;
  const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da === 0 || db === 0 ? null : num / Math.sqrt(da * db);
}

describe("bench — ranking sobre el mismo universo", () => {
  it("mide recall@10 y correlación contra un orden por calidad", async () => {
    const rows: Array<Record<string, unknown>> = [];
    console.log("\nzona        pool  ref  recall@10  recall@20  ρ(común)  calidad@10  nuestra#1");
    for (const zone of ZONES) {
      let places: Place[];
      try {
        places = await appPool(zone);
      } catch (e) {
        console.log(`${zone.name.padEnd(11)} ERROR ${String(e).slice(0, 50)}`);
        continue;
      }
      if (places.length < 5) {
        console.log(`${zone.name.padEnd(11)} ${String(places.length).padStart(4)}  (pool chico)`);
        continue;
      }
      const ours = places; // ya viene ordenado por el score de la app
      const ref = referenceOrder(places);

      const ourTop10 = ours.slice(0, 10);
      const refTop10 = new Set(ref.slice(0, 10).map((p) => p.id));
      const refTop20 = new Set(ref.slice(0, 20).map((p) => p.id));
      const recall10 = ourTop10.filter((p) => refTop10.has(p.id)).length;
      const recall20 = ourTop10.filter((p) => refTop20.has(p.id)).length;

      const refIdx = new Map(ref.map((p, i) => [p.id, i + 1]));
      const common = ours.slice(0, 30).filter((p) => refIdx.has(p.id));
      const rho = spearman(
        common.map((_, i) => i + 1),
        common.map((p) => refIdx.get(p.id)!)
      );

      const rated = ourTop10.map((p) => p.rating).filter((r): r is number => typeof r === "number");
      const quality = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;

      rows.push({ zone: zone.name, pool: places.length, ref: ref.length, recall10, recall20, rho, common: common.length, quality });
      console.log(
        `${zone.name.padEnd(11)} ${String(places.length).padStart(4)} ${String(ref.length).padStart(4)}  ` +
        `${String(recall10).padStart(7)}/10 ${String(recall20).padStart(8)}/10  ` +
        `${(rho === null ? "n/a" : rho.toFixed(2)).padStart(8)}  ` +
        `${(quality === null ? "-" : quality.toFixed(2)).padStart(9)}  ` +
        `${ourTop10[0]?.name.slice(0, 24) ?? "-"}`
      );
      await sleep(300);
    }

    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const rhos = rows.map((r) => r.rho).filter((v): v is number => typeof v === "number");
    const quality = rows.map((r) => r.quality).filter((v): v is number => typeof v === "number");
    const summary = {
      zonas: rows.length,
      recall10: mean(rows.map((r) => r.recall10 as number)),
      recall20: mean(rows.map((r) => r.recall20 as number)),
      rho: mean(rhos),
      calidad: mean(quality),
      pool: mean(rows.map((r) => r.pool as number)),
    };
    console.log(
      `\n── resumen ──\npool/zona ${summary.pool.toFixed(0)} | ` +
      `recall@10 ${summary.recall10.toFixed(1)}/10 | recall@20 ${summary.recall20.toFixed(1)}/10 | ` +
      `ρ ${summary.rho.toFixed(3)} | calidad@10 ${summary.calidad.toFixed(2)}`
    );
    console.log("recall@10 = de los 10 mejores de la zona, cuántos muestra la app.");
    console.log("ρ = correlación de orden sobre el mismo universo (sin matching).\n");

    mkdirSync("data/e2e-audit", { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    writeFileSync(`data/e2e-audit/bench-ranking-${stamp}.json`, JSON.stringify({ summary, rows }, null, 2));
  });
});
