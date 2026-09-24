import type { CrowdEstimate, CrowdLabel, WeatherInfo } from "../types";
import { isOpenAt, type OpenPeriod } from "../open-hours";
import { blendWithReports, learnedDelta, type CrowdReport } from "./reports";

/**
 * Typical busyness by experience type and wall-clock hour — the baseline of
 * the "gente ahora" estimate. Deliberately a small hand-fitted table, not a
 * learned model: review volume already carries "how popular", so the curve
 * only describes the *shape* of a day. Values are multipliers around 1.0.
 */
export type CrowdCategory =
  | "temple"
  | "museum"
  | "food"
  | "market"
  | "shopping"
  | "park"
  | "sakura"
  | "viewpoint"
  | "trekking"
  | "onsen"
  | "nightlife"
  | "other";

interface Window {
  from: number; // fractional hour, inclusive
  to: number; // fractional hour, exclusive — may wrap past midnight
  value: number;
}

interface Curve {
  /** outside every window (night, before opening) */
  base: number;
  windows: Window[];
}

const CURVES: Record<CrowdCategory, Curve> = {
  temple: { base: 0.12, windows: [{ from: 7, to: 17.5, value: 1 }, { from: 10, to: 14, value: 1.2 }] },
  museum: { base: 0.1, windows: [{ from: 9.5, to: 17.5, value: 1 }, { from: 11, to: 15, value: 1.15 }] },
  food: { base: 0.18, windows: [{ from: 11, to: 14.5, value: 1 }, { from: 17.5, to: 21.5, value: 1.1 }] },
  market: { base: 0.15, windows: [{ from: 8, to: 14, value: 1.15 }] },
  shopping: { base: 0.15, windows: [{ from: 10, to: 19.5, value: 1 }, { from: 13, to: 17, value: 1.1 }] },
  park: { base: 0.18, windows: [{ from: 8.5, to: 17.5, value: 1 }, { from: 10, to: 15, value: 1.1 }] },
  sakura: { base: 0.15, windows: [{ from: 9, to: 17.5, value: 1.1 }, { from: 11, to: 15, value: 1.25 }] },
  viewpoint: { base: 0.15, windows: [{ from: 9, to: 19, value: 1 }, { from: 15, to: 18.5, value: 1.15 }] },
  trekking: { base: 0.08, windows: [{ from: 6.5, to: 15.5, value: 1 }] },
  onsen: { base: 0.2, windows: [{ from: 10, to: 22, value: 1 }, { from: 17, to: 21, value: 1.15 }] },
  // wraps midnight: 19:00 → 02:00
  nightlife: { base: 0.05, windows: [{ from: 19, to: 2, value: 1.2 }] },
  other: { base: 0.35, windows: [{ from: 9, to: 20, value: 0.9 }] },
};

/** Experience-type tags → crowd category (first match wins). */
const TAG_CATEGORY: Record<string, CrowdCategory> = {
  temple: "temple",
  museum: "museum",
  food: "food",
  market: "market",
  shopping: "shopping",
  park: "park",
  sakura: "sakura",
  viewpoint: "viewpoint",
  trekking: "trekking",
  onsen: "onsen",
  nightlife: "nightlife",
};

export function categoryOf(tags: string[]): CrowdCategory {
  for (const t of tags) {
    const c = TAG_CATEGORY[t];
    if (c) return c;
  }
  return "other";
}

function inWindow(hour: number, w: Window): boolean {
  return w.to > w.from ? hour >= w.from && hour < w.to : hour >= w.from || hour < w.to;
}

/** Expected crowd multiplier at a destination-local wall-clock time. */
export function hourCurve(category: CrowdCategory, hour: number): number {
  const c = CURVES[category];
  let value = c.base;
  for (const w of c.windows) {
    if (inWindow(hour, w)) value = Math.max(value, w.value);
  }
  return value;
}

/** Hours when the category is typically visitable — the fallback "opening
 *  window" when Google periods are unavailable. */
export function openWindows(category: CrowdCategory): Window[] {
  return CURVES[category].windows.filter((w) => w.value >= 0.9);
}

/** Weekends and holidays bring day-trippers: shrines and blossom spots jump,
 *  business-district food barely moves. */
const DAY_FACTOR: Record<CrowdCategory, number> = {
  temple: 1.35,
  museum: 1.25,
  food: 1.15,
  market: 1.4,
  shopping: 1.3,
  park: 1.3,
  sakura: 1.5,
  viewpoint: 1.15,
  trekking: 1.3,
  onsen: 1.15,
  nightlife: 1.25,
  other: 1.1,
};

export function dayFactor(category: CrowdCategory, weekendOrHoliday: boolean): number {
  return weekendOrHoliday ? DAY_FACTOR[category] : 1;
}

const OUTDOOR: CrowdCategory[] = ["temple", "viewpoint", "park", "trekking", "sakura"];

export function isOutdoor(category: CrowdCategory): boolean {
  return OUTDOOR.includes(category);
}

/**
 * Weather distortion. Rain does not just subtract people — it MOVES them:
 * outdoor spots empty out while museums, onsens and shopping streets absorb
 * the crowd.
 */
export function weatherFactor(category: CrowdCategory, weather?: WeatherInfo): number {
  if (!weather) return 1;
  const wet = weather.condition === "rain" || weather.condition === "storm" || weather.snowCm > 0;
  const outdoor = isOutdoor(category);
  let f = 1;
  if (wet) f *= outdoor ? 0.6 : 1.15;
  else if (weather.condition === "cloudy" || weather.condition === "fog") f *= outdoor ? 0.9 : 1;
  // heat / cold extremes: same asymmetry
  if (weather.tempC >= 33 || weather.tempC <= 0) f *= outdoor ? 0.85 : 1.1;
  return f;
}

/**
 * Sakura season (late March – early April) is the single biggest crowd event
 * in Japan. Heuristic window, not a bloom forecast: `// ponytail: fixed dates,
 * swap for a real 開花 forecast feed if the date ever matters more than ±3 days`.
 */
const SAKURA_WINDOW = { fromMonth: 3, fromDay: 25, toMonth: 4, toDay: 10 };

export function seasonFactor(category: CrowdCategory, date: Date): number {
  if (category !== "sakura" && category !== "park") return 1;
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const inSakura =
    (m === SAKURA_WINDOW.fromMonth && d >= SAKURA_WINDOW.fromDay) ||
    (m === SAKURA_WINDOW.toMonth && d <= SAKURA_WINDOW.toDay);
  if (!inSakura) return 1;
  return category === "sakura" ? 1.5 : 1.2;
}

/** Labels for the estimate factors, shown to the user as reasons. */
export function activeFactors(
  category: CrowdCategory,
  opts: { weekendOrHoliday: boolean; weather?: WeatherInfo; date: Date }
): string[] {
  const out: string[] = [];
  if (opts.weekendOrHoliday) out.push("weekend");
  const w = opts.weather;
  if (w && (w.condition === "rain" || w.condition === "storm" || w.snowCm > 0)) {
    out.push(isOutdoor(category) ? "rainOutdoor" : "rainIndoor");
  }
  if (seasonFactor(category, opts.date) > 1) out.push("sakura");
  return out;
}

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
