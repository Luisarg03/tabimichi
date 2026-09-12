/**
 * Turn per-place crowd levels into a zone layer: "people are around HERE".
 *
 * A place is a point, but the user asks about an AREA — is this district
 * lively or dead right now. So each place bleeds its crowd level into a
 * gaussian neighbourhood on a ~150 m lattice, and the summed field is what
 * the map draws. Weights are relative to the busiest cell so the layer keeps
 * its shape as the hour changes.
 */

export interface HeatPoint {
  lat: number;
  lng: number;
  /** 0..1 crowd level of the place */
  weight: number;
}

export interface HeatOptions {
  /** gaussian sigma in metres */
  sigmaM?: number;
  /** lattice step in metres */
  cellM?: number;
  /** cells below this fraction of the max are dropped */
  minWeight?: number;
  maxCells?: number;
}

const METERS_PER_DEG_LAT = 110_540;
const METERS_PER_DEG_LNG = 111_320;

/** [lat, lng, weight 0..1] triples, heaviest first. */
export type HeatCell = [number, number, number];

export function crowdCells(points: HeatPoint[], opts: HeatOptions = {}): HeatCell[] {
  if (points.length === 0) return [];
  const sigma = opts.sigmaM ?? 200;
  const cell = opts.cellM ?? 150;
  const minWeight = opts.minWeight ?? 0.05;
  const maxCells = opts.maxCells ?? 600;

  const refLat = points.reduce((a, p) => a + p.lat, 0) / points.length;
  const latStep = cell / METERS_PER_DEG_LAT;
  const lngStep = cell / (METERS_PER_DEG_LNG * Math.max(0.2, Math.cos((refLat * Math.PI) / 180)));
  // reach: how many lattice cells the gaussian touches (3σ, at least 1)
  const reach = Math.max(1, Math.ceil((3 * sigma) / cell));
  const twoSigmaSq = 2 * sigma * sigma;
  const cells = new Map<string, { i: number; j: number; w: number }>();

  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || p.weight <= 0) continue;
    const ci = Math.round(p.lat / latStep);
    const cj = Math.round(p.lng / lngStep);
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let j = cj - reach; j <= cj + reach; j++) {
        const dLatM = (i * latStep - p.lat) * METERS_PER_DEG_LAT;
        const dLngM = (j * lngStep - p.lng) * METERS_PER_DEG_LNG * Math.cos((refLat * Math.PI) / 180);
        const d2 = dLatM * dLatM + dLngM * dLngM;
        if (d2 > 9 * sigma * sigma) continue;
        const w = p.weight * Math.exp(-d2 / twoSigmaSq);
        const key = `${i},${j}`;
        const existing = cells.get(key);
        if (existing) existing.w += w;
        else cells.set(key, { i, j, w });
      }
    }
  }

  const all = [...cells.values()].sort((a, b) => b.w - a.w);
  const max = all[0]?.w ?? 0;
  if (max <= 0) return [];
  return all
    .filter((c) => c.w / max >= minWeight)
    .slice(0, maxCells)
    .map((c): HeatCell => [
      Number((c.i * latStep).toFixed(5)),
      Number((c.j * lngStep).toFixed(5)),
      Number((c.w / max).toFixed(3)),
    ]);
}
