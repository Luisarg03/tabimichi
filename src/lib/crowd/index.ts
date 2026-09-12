import type { WeatherInfo } from "../types";
import type { OpenPeriod } from "../open-hours";
import { popularityScores, type PopularityInput } from "./popularity";
import { estimateCrowd, type CrowdEstimate } from "./estimate";
import { readCrowdReports } from "./store";
import { isInJapan, isJapaneseHoliday } from "./holidays";
import { crowdCells, type HeatCell } from "./heat";

export type { CrowdEstimate, CrowdLabel } from "./estimate";
export type { CrowdReport } from "./reports";
export type { HeatCell } from "./heat";

export interface CrowdPoolPlace extends PopularityInput {
  lat: number;
  lng: number;
  periods?: OpenPeriod[];
}

export interface CrowdResult {
  /** place id → estimate (same ids as the pool) */
  byId: Map<string, CrowdEstimate>;
  /** zone layer for the map */
  cells: HeatCell[];
}

export interface CrowdOptions {
  /** destination-local wall clock in UTC fields (see lib/jst.ts) */
  now: Date;
  /** search centre — decides whether Japanese holidays apply */
  lat: number;
  lng: number;
  weather?: WeatherInfo;
  /** signed-in user whose own observations feed back in */
  userId?: string | null;
}

/**
 * One pass over the discovered pool: everybody's crowd estimate at `now`,
 * plus the zone layer for the map. Every input already travelled with the
 * request (ratings, tags, hours, weather, clock) — the only extra lookups are
 * the user's own reports and the holiday calendar, and both degrade to
 * nothing when unavailable.
 */
export async function crowdForPool(
  pool: CrowdPoolPlace[],
  opts: CrowdOptions
): Promise<CrowdResult> {
  const byId = new Map<string, CrowdEstimate>();
  if (pool.length === 0) return { byId, cells: [] };

  const reports = await readCrowdReports(
    pool.map((p) => p.id),
    opts.userId ?? null
  );
  const holiday = isInJapan(opts.lat, opts.lng) && isJapaneseHoliday(opts.now);

  const popularity = popularityScores(pool);
  for (const p of pool) {
    byId.set(
      p.id,
      estimateCrowd(
        { tags: p.tags, popularity: popularity.get(p.id) ?? 0.3, periods: p.periods },
        { now: opts.now, weather: opts.weather, holiday, reports: reports.get(p.id) ?? [] }
      )
    );
  }

  const cells = crowdCells(
    pool.map((p) => ({ lat: p.lat, lng: p.lng, weight: byId.get(p.id)?.level ?? 0 }))
  );
  return { byId, cells };
}
