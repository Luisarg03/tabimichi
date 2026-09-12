/**
 * The user's own eyes, folded back into the estimate.
 *
 * The model can say "Kinkaku-ji is busy at 11:00 on a Sunday" but only an
 * observation knows that today the tour buses arrived early. Every report is
 * one tap, stored with the place and the instant, and used twice:
 *  - RECENT reports (last 3 h) override the estimate for that place, with a
 *    weight that decays the older they are;
 *  - OLD reports (up to 60 days) become a learned per-place correction for
 *    the same time-of-day bucket and weekday/weekend flag, so the model
 *    drifts toward what this place actually does.
 *
 * Each report carries the DESTINATION-LOCAL hour and weekday it was observed
 * at, captured when the tap happened. Server time is UTC (Vercel), so deriving
 * them at read time would bucket a Nara sighting by the wrong hour.
 */
import type { CrowdSource } from "../types";

export type { CrowdSource } from "../types";

export interface CrowdReport {
  placeId: string;
  /** 0 = empty, 1 = normal, 2 = packed */
  level: 0 | 1 | 2;
  /** epoch ms of the observation */
  at: number;
  /** destination-local fractional hour (0–24) at the moment of the report */
  localHour: number;
  /** destination-local weekend/holiday flag at the moment of the report */
  weekend: boolean;
}

/** Report level → position on the 0..1 crowd scale. */
export const REPORT_LEVEL_SCALE = [0.15, 0.5, 0.85] as const;

export const RECENT_REPORT_MS = 3 * 60 * 60 * 1000;
export const LEARNED_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
/** Below this many samples a learned correction is noise, not a pattern. */
export const LEARNED_MIN_SAMPLES = 2;
export const LEARNED_MAX_DELTA = 0.2;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function reportValue(level: 0 | 1 | 2): number {
  return REPORT_LEVEL_SCALE[level] ?? 0.5;
}

/** Time-of-day bucket used to group learned corrections (3-hour buckets). */
export function hourBucket(hour: number): number {
  return Math.floor(hour / 3);
}

/**
 * Correction learned from this place's older reports for the same bucket of
 * the day. Additive and capped: it nudges the model, never replaces it.
 */
export function learnedDelta(
  reports: CrowdReport[],
  opts: { hour: number; weekend: boolean; nowMs: number }
): number {
  const bucket = hourBucket(opts.hour);
  const samples: number[] = [];
  for (const r of reports) {
    const age = opts.nowMs - r.at;
    if (age < 0 || age > LEARNED_MAX_AGE_MS) continue;
    if (hourBucket(r.localHour) !== bucket || r.weekend !== opts.weekend) continue;
    samples.push(reportValue(r.level));
  }
  if (samples.length < LEARNED_MIN_SAMPLES) return 0;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const delta = (mean - 0.5) * 0.4;
  return Math.max(-LEARNED_MAX_DELTA, Math.min(LEARNED_MAX_DELTA, delta));
}

export interface BlendResult {
  level: number;
  source: CrowdSource;
  /** ISO instant of the freshest report that moved the value */
  observedAt?: string;
  /** how many recent reports were folded in */
  recentCount: number;
}

/**
 * Fold recent reports into the model value. One tap counts, two agreeing taps
 * win: a single report is a hint (w = 0.8 at best, decaying with age), while
 * two reports from the last three hours are treated as the truth for that
 * place — the whole point of reporting is that it beats guessing.
 */
export function blendWithReports(
  modelLevel: number,
  reports: CrowdReport[],
  nowMs: number
): BlendResult {
  const recent = reports
    .filter((r) => {
      const age = nowMs - r.at;
      return age >= 0 && age <= RECENT_REPORT_MS;
    })
    .sort((a, b) => b.at - a.at);
  if (recent.length === 0) return { level: clamp01(modelLevel), source: "model", recentCount: 0 };

  let weightSum = 0;
  let valueSum = 0;
  for (const r of recent) {
    const age = nowMs - r.at;
    const w = 0.8 * Math.exp(-age / RECENT_REPORT_MS);
    weightSum += w;
    valueSum += w * reportValue(r.level);
  }
  let w = weightSum;
  if (recent.length >= 2) {
    const distinct = new Set(recent.map((r) => r.level));
    // two reports that agree are strong evidence; two that disagree just mean
    // "somewhere in between", so they keep the normal weight
    if (distinct.size === 1) w = Math.max(w, 0.9);
  }
  const observed = valueSum / weightSum;
  return {
    level: clamp01(modelLevel * (1 - w) + observed * w),
    // "observed" is a claim: the user's tap is what the number says. It takes
    // two agreeing reports (w ≥ 0.9) or one very fresh one (≤ ~20 min).
    source: w >= 0.7 ? "observed" : "mixed",
    observedAt: new Date(recent[0].at).toISOString(),
    recentCount: recent.length,
  };
}
