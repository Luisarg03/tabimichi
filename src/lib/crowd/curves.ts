import type { WeatherInfo } from "../types";

/**
 * How busy a place TYPICALLY is, by experience type and wall-clock hour.
 *
 * This is the baseline of the "gente ahora" estimate. It is deliberately a
 * small hand-fitted table, not a learned model: the signal we actually have
 * (real review volume per place) already carries the "how popular is this"
 * part, so the curve only has to describe the *shape* of a day: temples fill
 * mid-morning, markets empty after lunch, bars only exist at night.
 *
 * Values are multipliers around 1.0 = "typical for this place".
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

/**
 * Weekends and Japanese public holidays bring out day-trippers: markets,
 * shrines and blossom spots jump, business-district food barely moves.
 */
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
 * the crowd. That asymmetry is what makes the estimate useful on a rainy day.
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
