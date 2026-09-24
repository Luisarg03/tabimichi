import { haversineKm } from "../geo";
import type { CrowdLabel, HotZone } from "../types";
import { labelFor } from "./estimate";
import type { HeatCell } from "./heat";

/**
 * Hot zones: named clusters over the crowd field.
 *
 * `crowdCells()` answers "how busy is each 150 m square", but the user asks
 * "WHERE is everybody" — a zone is a thing you can tap, rank and fly to. This
 * module groups hot cells (single-linkage over grid neighbours, in metres)
 * into at most a handful of zones with a centroid, a radius and the member
 * places, so the map draws circles and the list can name them ("Zona 1").
 *
 * Pure and deterministic: same cells + same places → same zones. No I/O,
 * no clock, no randomness. Weights arrive already normalized to the request
 * max (see heat.ts), so the "hot" threshold is stable across searches.
 */

export interface ZonePlace {
  id: string;
  lat: number;
  lng: number;
  /** 0..1 crowd level of the place (for member ranking) */
  level: number;
}

export interface ZoneOptions {
  /** cells below this normalized weight never seed or join a zone */
  minWeight?: number;
  /** max gap (metres) between a cell and any cluster member to join it */
  linkM?: number;
  /** zones returned, heaviest first */
  maxZones?: number;
  /** a lone cell needs at least this weight to become a zone alone */
  soloMinWeight?: number;
  /** member places kept per zone, busiest first */
  maxPlaces?: number;
  /** radius clamp (metres) */
  minRadiusM?: number;
  maxRadiusM?: number;
}

const DEFAULTS: Required<ZoneOptions> = {
  minWeight: 0.55,
  linkM: 300,
  maxZones: 5,
  soloMinWeight: 0.8,
  maxPlaces: 8,
  minRadiusM: 150,
  maxRadiusM: 600,
};

function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return haversineKm({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng }) * 1000;
}

/** Cluster hot cells by single-linkage: a cell joins the first (heaviest-seeded)
 *  cluster with any member within linkM. Deterministic: input order decides. */
function cluster(
  cells: Array<{ lat: number; lng: number; w: number }>,
  linkM: number
): Array<Array<{ lat: number; lng: number; w: number }>> {
  const clusters: Array<Array<{ lat: number; lng: number; w: number }>> = [];
  for (const c of cells) {
    let target: Array<{ lat: number; lng: number; w: number }> | undefined;
    for (const cl of clusters) {
      if (cl.some((m) => distM(c.lat, c.lng, m.lat, m.lng) <= linkM)) {
        target = cl;
        break;
      }
    }
    if (target) target.push(c);
    else clusters.push([c]);
  }
  return clusters;
}

export function hotZones(
  cells: HeatCell[],
  places: ZonePlace[],
  opts: ZoneOptions = {}
): HotZone[] {
  const o = { ...DEFAULTS, ...opts };
  if (cells.length === 0) return [];

  // heaviest first, coordinates break ties → deterministic
  const hot = cells
    .filter(
      ([lat, lng, w]) =>
        Number.isFinite(lat) && Number.isFinite(lng) && w >= o.minWeight
    )
    .map(([lat, lng, w]) => ({ lat, lng, w }))
    .sort((a, b) => b.w - a.w || a.lat - b.lat || a.lng - b.lng);
  if (hot.length === 0) return [];

  const validPlaces = places.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );

  const zones: HotZone[] = [];
  let n = 0;
  for (const members of cluster(hot, o.linkM)) {
    const weight = Math.max(...members.map((m) => m.w));
    // a lone cell only counts when it is screaming hot on its own
    if (members.length < 2 && weight < o.soloMinWeight) continue;

    // weight-averaged centroid — the field's centre of mass, not the grid
    const wSum = members.reduce((a, m) => a + m.w, 0);
    const lat = members.reduce((a, m) => a + m.lat * m.w, 0) / wSum;
    const lng = members.reduce((a, m) => a + m.lng * m.w, 0) / wSum;

    // radius: p95 distance of member cells to the centroid, clamped
    const dists = members
      .map((m) => distM(lat, lng, m.lat, m.lng))
      .sort((a, b) => a - b);
    const p95 = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.95))];
    const radiusM = Math.round(
      Math.min(o.maxRadiusM, Math.max(o.minRadiusM, p95))
    );

    const placeIds = validPlaces
      .map((p) => ({ p, d: distM(lat, lng, p.lat, p.lng) }))
      .filter(({ d }) => d <= radiusM)
      .sort((a, b) => b.p.level - a.p.level || a.d - b.d)
      .slice(0, o.maxPlaces)
      .map(({ p }) => p.id);

    const label: CrowdLabel = labelFor(weight);
    zones.push({
      id: `z${++n}`,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      radiusM,
      weight: Number(weight.toFixed(3)),
      label,
      placeIds,
    });
    if (zones.length >= o.maxZones) break;
  }
  return zones;
}
