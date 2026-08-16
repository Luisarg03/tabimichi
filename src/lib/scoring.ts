import type { Place, Reason, ScoredPlace, WeatherInfo, LatLng, TransportMode } from "./types";
import { haversineKm, travelMin } from "./geo";
import { EXPERIENCE_TYPE_MAP } from "./places/taxonomy";
import { fmtCount } from "./format";
import { keywordTokens, matchesKeyword } from "./keywords";

export interface ScoreContext {
  base: LatLng;
  budgetMin: number;
  weather: WeatherInfo;
  now: Date;
  mode?: TransportMode;
  /** hard max distance (km); results beyond it are dropped */
  maxDistKm?: number;
  /**
   * Real mode: closed places are NOT dropped — they get a penalty + a
   * "closedNow" reason and the card shows a badge (Google-Maps style).
   * Simulation keeps the hard filter so the simulator answers
   * "qué está abierto a esta hora" precisely.
   */
  softClosed?: boolean;
  /**
   * Optional interest keyword: places whose name matches get a big boost
   * (+20, reason "keywordMatch") and are exempt from chain/hotel penalties —
   * if the user explicitly asks for "Sukiya", Sukiya must rank.
   */
  keyword?: string;
  /** M3: learned tag weights from 👍/👎 feedback, e.g. { onsen: 2, food: -1 } */
  profile?: Record<string, number>;
  /** dev tracing: counters of why candidates were dropped (mutated) */
  stats?: { closed: number; tooFar: number; keywordHits?: number };
}

function isIndoor(tag: string): boolean {
  return Boolean(EXPERIENCE_TYPE_MAP[tag]?.indoor);
}

function isOutdoor(tag: string): boolean {
  return Boolean(EXPERIENCE_TYPE_MAP[tag]?.outdoor);
}

// ---------------------------------------------------------------------------
// Quality penalties: ubiquitous chains and hotels are noise for discovery.
// ---------------------------------------------------------------------------

/** Ubiquitous Japanese (and global) chains — a foodie wants the local gem, not Sukiya. */
export const CHAIN_NAMES = [
  "mcdonald",
  "マクドナルド",
  "sukiya",
  "すき家",
  "matsuya",
  "松屋",
  "yoshinoya",
  "吉野家",
  "gusto",
  "ガスト",
  "royal host",
  "kfc",
  "mos burger",
  "モスバーガー",
  "starbucks",
  "スターバックス",
  "doutor",
  "ドトール",
  "pronto",
  "saizeriya",
  "サイゼリヤ",
  "coco ichibanya",
  "ココイチ",
  "bikkuri donkey",
  "びっくりドンキー",
  "joyfull",
  "ジョイフル",
  "denny",
  "デニーズ",
  "hidakaya",
  "日高屋",
  "pepper lunch",
  "ペッパーランチ",
  "first kitchen",
  "lotteria",
  "kura sushi",
  "くら寿司",
  "sushiro",
  "スシロー",
  "hamazushi",
  "はま寿司",
  "kappazushi",
  "かっぱ寿司",
  "ootoya",
  "大戸屋",
  "yayoiken",
  "やよい軒",
  "torikizoku",
  "鳥貴族",
  "jonathan",
  "ジョナサン",
  "coco's",
  "coco壱番屋",
] as const;

export function isChainName(name: string): boolean {
  const n = name.toLowerCase();
  return CHAIN_NAMES.some((c) => n.includes(c.toLowerCase()));
}

/** Accommodation signals — a hotel is not "something to do" (unless it has an onsen). */
const HOTEL_RE = /hotel|ホテル|旅館|ryokan/i;

export function isHotelName(name: string): boolean {
  return HOTEL_RE.test(name);
}

/**
 * Rule-based "base fit" score (0-100) + human-readable reasons.
 * The LLM (next phase) will narrate, not score.
 */
export function scorePlaces(places: Place[], ctx: ScoreContext): ScoredPlace[] {
  const { base, budgetMin, weather } = ctx;
  const out: ScoredPlace[] = [];
  const kwTokens = ctx.keyword ? keywordTokens(ctx.keyword) : [];

  for (const p of places) {
    const distanceKm = haversineKm(base, p);
    const t = travelMin(distanceKm, ctx.mode);

    // hard filters: beyond the discovery radius, or too far for the budget (25% slack)
    if (ctx.maxDistKm !== undefined && distanceKm > ctx.maxDistKm) {
      ctx.stats && ctx.stats.tooFar++;
      continue;
    }
    if (t > budgetMin * 1.25) {
      ctx.stats && ctx.stats.tooFar++;
      continue;
    }
    // hard filter: never recommend places that are closed right now
    if (p.openNow === false) {
      ctx.stats && ctx.stats.closed++;
      if (!ctx.softClosed) continue;
    }

    // interest keyword: name match → big boost; the user asked for THIS
    const kwHit = kwTokens.length > 0 && matchesKeyword(p.name ?? "", kwTokens);
    if (kwHit) {
      ctx.stats && (ctx.stats.keywordHits = (ctx.stats.keywordHits ?? 0) + 1);
    }

    let score = 50;
    const reasons: Reason[] = [];

    // --- travel (graduated by minutes so close wins over far) ---
    if (t <= 5) {
      score += 18;
      reasons.push({ key: "distanceGood", params: { min: t, modeId: ctx.mode ?? "transit" } });
    } else if (t <= 10) {
      score += 15;
      reasons.push({ key: "distanceGood", params: { min: t, modeId: ctx.mode ?? "transit" } });
    } else if (t <= 20) {
      score += 12;
      reasons.push({ key: "distanceGood", params: { min: t, modeId: ctx.mode ?? "transit" } });
    } else if (t <= 35) {
      score += 9;
    } else if (t <= 60) {
      score += 6;
    } else {
      score += 3;
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
      // Bayesian shrinkage with a lower prior (3.7/25) and a review cap (500):
      // a 4.7 local with 50 reviews keeps its edge over a 4.0 chain with 5k
      // reviews, while a 4.9 with 3 reviews still gets pulled down.
      const n = Math.min(p.userRatingsTotal ?? 0, 500);
      const weighted = n > 0 ? (p.rating * n + 3.7 * 25) / (n + 25) : p.rating;

      if (weighted >= 4.6) {
        score += 16;
        reasons.push({ key: "highRated", params: { r: weighted.toFixed(1) } });
      } else if (weighted >= 4.3) {
        score += 12;
        reasons.push({ key: "highRated", params: { r: weighted.toFixed(1) } });
      } else if (weighted >= 4.0) {
        score += 8;
      } else if (weighted >= 3.5) {
        score += 3;
      } else {
        score -= 4; // actively penalize mediocre places
      }

      // review volume: established places, capped so it never dominates
      const total = p.userRatingsTotal ?? 0;
      if (total >= 5000) {
        score += 6;
        reasons.push({ key: "popular", params: { n: fmtCount(total) } });
      } else if (total >= 1000) {
        score += 5;
        reasons.push({ key: "popular", params: { n: fmtCount(total) } });
      } else if (total >= 300) {
        score += 4;
      } else if (total >= 100) {
        score += 3;
      } else if (total >= 30) {
        score += 2;
      } else if (total >= 5) {
        score += 1;
      }
    }

    // --- interest keyword: explicit user intent wins over noise rules ---
    if (kwHit) {
      score += 20;
      reasons.push({ key: "keywordMatch", params: { kw: ctx.keyword ?? "" } });
    }

    // --- noise penalties: chains & hotels (skipped when the keyword matched:
    // the user asked for that exact place, e.g. "Sukiya") ---
    const name = p.name ?? "";
    if (!kwHit && isChainName(name)) {
      score -= 12;
      reasons.push({ key: "chain" });
    }
    // a ryokan with an onsen is an experience for this user — exempt it
    if (!kwHit && isHotelName(name) && !p.tags.includes("onsen")) {
      score -= 12;
      reasons.push({ key: "hotel" });
    }

    if (p.openNow === true) {
      score += 6;
      reasons.push({ key: "openNow" });
    } else if (p.openNow === false && ctx.softClosed) {
      // soft mode: closed places stay discoverable but sink below open ones
      score -= 15;
      reasons.push({ key: "closedNow" });
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
