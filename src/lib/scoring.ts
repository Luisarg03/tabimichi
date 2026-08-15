import type { Place, Reason, ScoredPlace, WeatherInfo, LatLng, TransportMode } from "./types";
import { haversineKm, travelMin } from "./geo";
import { EXPERIENCE_TYPE_MAP } from "./places/taxonomy";
import { fmtCount } from "./format";

export interface ScoreContext {
  base: LatLng;
  budgetMin: number;
  weather: WeatherInfo;
  now: Date;
  mode?: TransportMode;
  /** hard max distance (km); results beyond it are dropped */
  maxDistKm?: number;
  /** M3: learned tag weights from 👍/👎 feedback, e.g. { onsen: 2, food: -1 } */
  profile?: Record<string, number>;
}

function isIndoor(tag: string): boolean {
  return Boolean(EXPERIENCE_TYPE_MAP[tag]?.indoor);
}

function isOutdoor(tag: string): boolean {
  return Boolean(EXPERIENCE_TYPE_MAP[tag]?.outdoor);
}

/**
 * Rule-based "base fit" score (0-100) + human-readable reasons.
 * The LLM (next phase) will narrate, not score.
 */
export function scorePlaces(places: Place[], ctx: ScoreContext): ScoredPlace[] {
  const { base, budgetMin, weather } = ctx;
  const out: ScoredPlace[] = [];

  for (const p of places) {
    const distanceKm = haversineKm(base, p);
    const t = travelMin(distanceKm, ctx.mode);

    // hard filters: beyond the discovery radius, or too far for the budget (25% slack)
    if (ctx.maxDistKm !== undefined && distanceKm > ctx.maxDistKm) continue;
    if (t > budgetMin * 1.25) continue;
    // hard filter: never recommend places that are closed right now
    if (p.openNow === false) continue;

    let score = 50;
    const reasons: Reason[] = [];

    // --- travel (graduated by minutes so close wins over far) ---
    if (t <= 10) {
      score += 16;
      reasons.push({ key: "distanceGood", params: { min: t, modeId: ctx.mode ?? "transit" } });
    } else if (t <= 20) {
      score += 13;
      reasons.push({ key: "distanceGood", params: { min: t, modeId: ctx.mode ?? "transit" } });
    } else if (t <= 35) {
      score += 10;
    } else if (t <= 60) {
      score += 7;
    } else {
      score += 4;
    }

    // --- weather fit ---
    const outdoorTags = p.tags.filter(isOutdoor);
    const indoorTags = p.tags.filter(isIndoor);
    const onFoot = ctx.mode === "walking";

    if (weather.condition === "rain") {
      if (indoorTags.length > 0) {
        score += 12;
        reasons.push({ key: "weatherRainIndoor", params: { typeId: indoorTags[0] } });
      }
      if (outdoorTags.length > 0) score -= onFoot ? 28 : 18; // walking in rain hurts more
    } else if (weather.condition === "snow") {
      if (p.tags.includes("onsen")) {
        score += 15;
        reasons.push({ key: "weatherSnowOnsen" });
      } else if (indoorTags.length > 0) {
        score += 8;
        reasons.push({ key: "weatherSnowIndoor", params: { typeId: indoorTags[0] } });
      }
      if (outdoorTags.length > 0) score -= onFoot ? 20 : 10;
    } else if (weather.condition === "clear" || weather.condition === "cloudy") {
      if (p.tags.includes("viewpoint") || p.tags.includes("trekking") || p.tags.includes("park")) {
        score += 10;
        reasons.push({ key: "weatherGoodOutdoor", params: { typeId: p.tags[0] } });
      }
    }

    if (weather.tempC <= 5 && p.tags.includes("onsen")) {
      score += 10;
      reasons.push({ key: "weatherCold", params: { typeId: "onsen" } });
    }

    // --- quality signals: rating shrunk by review count + volume ---
    if (p.rating !== undefined) {
      const n = p.userRatingsTotal ?? 0;
      // Bayesian shrinkage: a 4.5 with 5 reviews ≈ 4.0; with 2k reviews it holds.
      // prior: 3.9 with 30 pseudo-reviews
      const weighted = n > 0 ? (p.rating * n + 3.9 * 30) / (n + 30) : p.rating;

      if (weighted >= 4.4) {
        score += 14;
        reasons.push({ key: "highRated", params: { r: weighted.toFixed(1) } });
      } else if (weighted >= 4.0) {
        score += 9;
      } else if (weighted >= 3.5) {
        score += 4;
      }

      // review volume: established places, capped so it never dominates
      if (n >= 5000) {
        score += 6;
        reasons.push({ key: "popular", params: { n: fmtCount(n) } });
      } else if (n >= 1000) {
        score += 5;
        reasons.push({ key: "popular", params: { n: fmtCount(n) } });
      } else if (n >= 300) {
        score += 4;
      } else if (n >= 100) {
        score += 3;
      } else if (n >= 30) {
        score += 2;
      } else if (n >= 5) {
        score += 1;
      }
    }

    if (p.openNow === true) {
      score += 6;
      reasons.push({ key: "openNow" });
    }

    // --- M3: profile affinity (learned tag weights from 👍/👎) ---
    const profile = ctx.profile;
    if (profile) {
      let affinity = 0;
      let bestTag: string | undefined;
      let bestWeight = 0;
      for (const tag of p.tags) {
        const w = profile[tag] ?? 0;
        if (w !== 0) {
          affinity += w;
          if (Math.abs(w) > Math.abs(bestWeight)) {
            bestTag = tag;
            bestWeight = w;
          }
        }
      }
      affinity = Math.max(-12, Math.min(12, affinity));
      score += affinity;
      if (affinity > 0 && bestTag) {
        reasons.push({ key: "profileLiked", params: { typeId: bestTag } });
      }
    }

    out.push({
      ...p,
      score: Math.max(0, Math.min(100, Math.round(score))),
      distanceKm: Math.round(distanceKm * 10) / 10,
      travelMin: t,
      reasons,
    });
  }

  out.sort((a, b) => b.score - a.score || a.travelMin - b.travelMin);
  return out;
}
