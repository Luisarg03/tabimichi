import type { CrowdEstimate, CrowdLabel, WeatherInfo } from "../types";
import { isOpenAt, type OpenPeriod } from "../open-hours";
import {
  activeFactors,
  categoryOf,
  dayFactor,
  hourCurve,
  openWindows,
  seasonFactor,
  weatherFactor,
} from "./curves";
import type { CrowdCategory } from "./curves";
import { blendWithReports, learnedDelta, type CrowdReport } from "./reports";

export type { CrowdEstimate, CrowdLabel } from "../types";

export interface CrowdContext {
  /** destination-local wall clock in UTC fields (same convention as scoring) */
  now: Date;
  weather?: WeatherInfo;
  /** destination-local public holiday */
  holiday?: boolean;
  /** this place's reports (recent + historical) */
  reports?: CrowdReport[];
}

export interface CrowdInput {
  tags: string[];
  /** 0..1 from popularityScores() */
  popularity: number;
  /** structured opening periods, when the source provided them */
  periods?: OpenPeriod[];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Base popularity: review volume (the same base Google's Popular Times builds
 * on) with a per-category pseudo-count fallback for sourceless rows, so one
 * scale serves both. Normalized against the pool's own p95 — one runaway
 * magnet must not flatten the rest to zero.
 */

/** Assumed review volume when the source reports none. */
const PSEUDO_REVIEWS: Record<CrowdCategory, number> = {
  temple: 300,
  museum: 120,
  food: 60,
  market: 100,
  shopping: 250,
  park: 150,
  sakura: 200,
  viewpoint: 80,
  trekking: 30,
  onsen: 70,
  nightlife: 40,
  other: 25,
};

/** A documented landmark (Wikipedia/Wikidata) draws beyond its review count. */
const WIKIPEDIA_BOOST = 1.3;

export interface PopularityInput {
  id: string;
  tags: string[];
  userRatingsTotal?: number;
  wikipedia?: string;
}

function rawScore(p: PopularityInput): number {
  const category = categoryOf(p.tags);
  const reviews = p.userRatingsTotal && p.userRatingsTotal > 0 ? p.userRatingsTotal : PSEUDO_REVIEWS[category];
  const boosted = p.wikipedia ? reviews * WIKIPEDIA_BOOST : reviews;
  return Math.log10(1 + boosted);
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx];
}

export function popularityScores(pool: PopularityInput[]): Map<string, number> {
  const out = new Map<string, number>();
  if (pool.length === 0) return out;
  const raws = pool.map(rawScore);
  const sorted = [...raws].sort((a, b) => a - b);
  const scale = Math.max(percentile(sorted, 0.95), 0.5);
  pool.forEach((p, i) => {
    out.set(p.id, Math.min(1, Math.max(0, raws[i] / scale)));
  });
  return out;
}

export function labelFor(level: number): CrowdLabel {
  if (level < 0.25) return "low";
  if (level < 0.5) return "medium";
  if (level < 0.75) return "high";
  return "veryHigh";
}

function isWeekendLocal(date: Date): boolean {
  const d = date.getUTCDay();
  return d === 0 || d === 6;
}

/** Fractional destination-local hour of a wall-clock Date in UTC fields. */
function localHourOf(date: Date): number {
  return date.getUTCHours() + date.getUTCMinutes() / 60;
}

/**
 * "How many people are there right now", as a 0..1 value plus the reasons
 * behind it. Four multipliers, in order of how much they move the number:
 * how popular the place is at all, what time it is, what day it is, and what
 * the weather is doing — then the user's own observations, if any.
 */
export function estimateCrowd(input: CrowdInput, ctx: CrowdContext): CrowdEstimate {
  const category = categoryOf(input.tags);
  const hour = localHourOf(ctx.now);
  const weekend = isWeekendLocal(ctx.now) || ctx.holiday === true;

  const model =
    input.popularity *
    hourCurve(category, hour) *
    dayFactor(category, weekend) *
    weatherFactor(category, ctx.weather) *
    seasonFactor(category, ctx.now);

  const reports = ctx.reports ?? [];
  const nowMs = Date.now();
  const learned = learnedDelta(reports, { hour, weekend, nowMs });
  const blended = blendWithReports(clamp01(model + learned), reports, nowMs);

  const bestHour = bestHourToday(input, ctx, category);

  return {
    level: blended.level,
    label: labelFor(blended.level),
    source: blended.source,
    observedAt: blended.observedAt,
    factors: activeFactors(category, { weekendOrHoliday: weekend, weather: ctx.weather, date: ctx.now }),
    ...(bestHour !== undefined ? { bestHour } : {}),
  };
}

/**
 * Quietest remaining hour today, among the hours the place is actually open.
 * Opening periods win when we have them; otherwise the category's typical
 * window stands in (approximate, and labelled as such in the UI).
 */
export function bestHourToday(
  input: CrowdInput,
  ctx: CrowdContext,
  category = categoryOf(input.tags)
): number | undefined {
  const nowHour = Math.floor(localHourOf(ctx.now));
  const windows = openWindows(category);
  let best: { hour: number; value: number } | undefined;

  for (let hour = nowHour + 1; hour <= 23; hour++) {
    const at = new Date(
      Date.UTC(
        ctx.now.getUTCFullYear(),
        ctx.now.getUTCMonth(),
        ctx.now.getUTCDate(),
        hour,
        0,
        0
      )
    );
    const open = input.periods && input.periods.length > 0
      ? isOpenAt(input.periods, at) === true
      : windows.some((w) => hour >= Math.floor(w.from) && hour < Math.ceil(w.to));
    if (!open) continue;
    const value = hourCurve(category, hour);
    if (!best || value < best.value) best = { hour, value };
  }
  return best?.hour;
}
