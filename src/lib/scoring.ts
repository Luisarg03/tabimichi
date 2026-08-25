import type { Place, Reason, ScoredPlace, WeatherInfo, LatLng, TransportMode } from "./types";
import { haversineKm, travelMin } from "./geo";
import { EXPERIENCE_TYPE_MAP } from "./places/taxonomy";
import { fmtCount } from "./format";
import { keywordTokens, matchesKeyword } from "./keywords";

export interface ScoreContext {
  base: LatLng;
  budgetMin: number;
  weather: WeatherInfo;
  /** destination-local wall clock stored in UTC fields (JST for simulated
   *  dates, longitude-shifted for real ones) — read with getUTC* getters */
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
  /** extra name-match tokens (e.g. the LLM-translated term for "gatos" → "cat"). */
  keywordTerms?: string[];
  /** M3: learned tag weights from 👍/👎 feedback, e.g. { onsen: 2, food: -1 } */
  profile?: Record<string, number>;
  /** dev tracing: counters of why candidates were dropped (mutated) */
  stats?: { closed: number; tooFar: number; nameMatches?: number };
  /** ids exempt from the closed/too-far hard filters — the pinned searched
   *  place must always show (with a closed badge when closed), never drop */
  pinnedIds?: Set<string>;
}

function isIndoor(tag: string): boolean {
  return Boolean(EXPERIENCE_TYPE_MAP[tag]?.indoor);
}

function isOutdoor(tag: string): boolean {
  return Boolean(EXPERIENCE_TYPE_MAP[tag]?.outdoor);
}

/** Minutes-of-day from a destination-local ISO time ("2026-08-20T05:10"). */
export function minsOfDay(iso: string): number | undefined {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
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

/** One-way travel cap (minutes) per transport mode — the day budget must not
 *  be spendable entirely on travel: walking means "around the point" (≤45 min
 *  on foot ≈ 3.4 km), transit ≤90, car ≤120. Also never more than half the
 *  day budget (a lunch outing has no 90-minute trips). */
const MODE_TRAVEL_CAP_MIN: Record<TransportMode, number> = { walking: 45, transit: 90, car: 120 };

/**
 * Rule-based "base fit" score (0-100) + human-readable reasons.
 * The LLM (next phase) will narrate, not score.
 */
export function scorePlaces(places: Place[], ctx: ScoreContext): ScoredPlace[] {
  const { base, budgetMin, weather } = ctx;
  const out: ScoredPlace[] = [];
  const kwTokens = ctx.keywordTerms ?? (ctx.keyword ? keywordTokens(ctx.keyword) : []);
  const travelCap = Math.min(budgetMin * 0.5, MODE_TRAVEL_CAP_MIN[ctx.mode ?? "transit"]);

  for (const p of places) {
    const distanceKm = haversineKm(base, p);
    const t = travelMin(distanceKm, ctx.mode);
    const pinned = ctx.pinnedIds?.has(p.id) === true;

    // hard filters: beyond the discovery radius, or too far to reach on the
    // day's budget + transport mode (walking is capped tight on purpose).
    // Pinned places are exempt — they are what the user searched for.
    if (!pinned && ctx.maxDistKm !== undefined && distanceKm > ctx.maxDistKm) {
      ctx.stats && ctx.stats.tooFar++;
      continue;
    }
    if (!pinned && t > travelCap) {
      ctx.stats && ctx.stats.tooFar++;
      continue;
    }
    // hard filter: never recommend places that are closed right now
    if (!pinned && p.openNow === false) {
      ctx.stats && ctx.stats.closed++;
      if (!ctx.softClosed) continue;
    }

    // interest keyword: name match → big boost; the user asked for THIS
    const kwHit = kwTokens.length > 0 && matchesKeyword(p.name ?? "", kwTokens);
    if (kwHit) {
      ctx.stats && (ctx.stats.nameMatches = (ctx.stats.nameMatches ?? 0) + 1);
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

    // --- time-of-day context (destination-local wall clock in UTC fields) ---
    const hour = ctx.now.getUTCHours();
    const mins = hour * 60 + ctx.now.getUTCMinutes();
    const isWeekend = ctx.now.getUTCDay() === 0 || ctx.now.getUTCDay() === 6;

    if (p.tags.includes("food") && ((hour >= 11 && hour < 15) || (hour >= 17 && hour < 22))) {
      score += 8;
      reasons.push({ key: "mealTime" });
    }
    if (p.tags.includes("nightlife") && (hour >= 20 || hour < 5)) {
      score += 8;
      reasons.push({ key: "nightTime" });
    }
    if (p.tags.includes("onsen") && hour >= 17 && hour < 23) {
      score += 6;
      reasons.push({ key: "onsenEvening" });
    }
    // golden hour: real local sunrise/sunset from Open-Meteo (when present)
    const sun = weather.daily?.[0];
    if (
      sun?.sunrise &&
      sun?.sunset &&
      (p.tags.includes("viewpoint") || p.tags.includes("trekking") || p.tags.includes("sakura"))
    ) {
      const rise = minsOfDay(sun.sunrise);
      const set = minsOfDay(sun.sunset);
      if (
        rise !== undefined &&
        set !== undefined &&
        ((mins >= rise - 60 && mins <= rise + 30) || (mins >= set - 60 && mins <= set + 30))
      ) {
        score += 8;
        reasons.push({ key: "goldenHour" });
      }
    }
    if (isWeekend && (p.tags.includes("park") || p.tags.includes("market") || p.tags.includes("sakura"))) {
      score += 4;
      reasons.push({ key: "weekend" });
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

    // --- landmark signal: Wikipedia/Wikidata-documented places are notable
    // (OSM rows carry the tag; skipped for keyword hits so intent wins) ---
    if (p.wikipedia && !kwHit) {
      score += 6;
      reasons.push({ key: "landmark" });
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
