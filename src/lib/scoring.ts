import type { Place, Reason, ScoredPlace, WeatherInfo, LatLng, TransportMode } from "./types";
import { haversineKm, travelMin } from "./geo";
import { EXPERIENCE_TYPE_MAP } from "./places/taxonomy";
import { cuisineOf, isLocalCuisine } from "./cuisine";
import { fmtCount } from "./format";
import { keywordTokens, matchesKeyword } from "./keywords";

export interface ScoreContext {
  base: LatLng;
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
  /** "gente ahora" levels by place id — only consulted when avoidCrowds */
  crowd?: Map<string, { level: number }>;
  /** user asked to stay away from the crowds: the crowd estimate MOVES the
   *  order instead of only decorating the card. Off by default: the estimate
   *  is a model, not a measurement, and silently reordering by it would
   *  contradict the app's own honesty rules. */
  avoidCrowds?: boolean;
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

/** One-way travel cap (minutes) per transport mode — walking means
 *  "around the point" (≤45 min on foot ≈ 3.4 km), transit ≤90, car ≤120. */
const MODE_TRAVEL_CAP_MIN: Record<TransportMode, number> = { walking: 45, transit: 90, car: 120 };

/**
 * Rule-based "base fit" score (0-100) + human-readable reasons.
 * The LLM (next phase) will narrate, not score.
 */
export function scorePlaces(places: Place[], ctx: ScoreContext): ScoredPlace[] {
  const { base, weather } = ctx;
  const out: ScoredPlace[] = [];
  const kwTokens = ctx.keywordTerms ?? (ctx.keyword ? keywordTokens(ctx.keyword) : []);
  const travelCap = MODE_TRAVEL_CAP_MIN[ctx.mode ?? "transit"];

  // Crowd rank inside this pool. The published level is normalized against the
  // pool's p95 popularity, so in a dense area EVERY candidate lands at
  // 0.93–1.00 — an absolute comparison sees no difference to rank. What the
  // user asks is "which of these is the quiet one HERE", so the level is
  // rescaled onto this pool's min–max before ranking. The badge the user reads
  // still shows the honest absolute label; only the ordering uses the spread.
  let crowdRank: Map<string, number> | undefined;
  if (ctx.avoidCrowds && ctx.crowd && ctx.crowd.size > 1) {
    const entries = [...ctx.crowd.entries()];
    const levels = entries.map(([, c]) => c.level);
    const lo = Math.min(...levels);
    const hi = Math.max(...levels);
    crowdRank = new Map();
    for (const [id, c] of entries) {
      // higher crowd level = busier, so the rank must DECREASE with it:
      // 1 = quietest of the pool, 0 = busiest.
      crowdRank.set(id, hi > lo ? (hi - c.level) / (hi - lo) : 0.5);
    }
  }

  for (const p of places) {
    const distanceKm = haversineKm(base, p);
    const t = travelMin(distanceKm, ctx.mode);
    const pinned = ctx.pinnedIds?.has(p.id) === true;

    // hard filters: beyond the discovery radius, or too far to reach on the
    // transport mode (walking is capped tight on purpose).
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
    const name = p.name ?? "";

    // --- travel: proximity is the whole promise ("the best of the best
    // NEAR my point"), so close wins decisively (≤5 min +25 vs ≤2.5 km +4)
    // and a 100 m walk can no longer be outweighed by one rating step.
    if (t <= 5) {
      score += 25;
      reasons.push({ key: "distanceGood", params: { min: t, modeId: ctx.mode ?? "transit" } });
    } else if (t <= 10) {
      score += 20;
      reasons.push({ key: "distanceGood", params: { min: t, modeId: ctx.mode ?? "transit" } });
    } else if (t <= 20) {
      score += 14;
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
      // Bayesian shrinkage (prior 3.9 with m=15 reviews) keeps a 4.9-with-3
      // from beating a 4.5-with-800, but it is shallow enough that a genuine
      // 4.4/61 still reads as 4.34 — the old m=25 pulled it to 4.30 and lost
      // to an anonymous OSM row with no rating at all.
      const n = Math.min(p.userRatingsTotal ?? 0, 500);
      const weighted = n > 0 ? (p.rating * n + 3.9 * 15) / (n + 15) : p.rating;
      // Two sloped segments that meet at 3.8: continuous (a 4.5 must outrank a
      // 4.3 instead of sharing a bucket, which is what made the order random),
      // but steep enough below 3.8 that a mediocre place loses clearly.
      score +=
        weighted >= 3.8
          ? Math.round((weighted - 3.8) * 12) + 4
          : Math.round((weighted - 3.8) * 26) - 4;

      // review volume only decides ties (1-6): the rating already carries it,
      // so the old 7-tier bonus double-counted popularity.
      const total = p.userRatingsTotal ?? 0;
      if (total > 0) {
        score += Math.min(6, Math.round(Math.log10(total) * 2));
        if (total >= 1000) {
          reasons.push({ key: "popular", params: { n: fmtCount(total) } });
        }
      }
      if (weighted >= 4.3) {
        reasons.push({ key: "highRated", params: { r: weighted.toFixed(1) } });
      }
    } else if (!p.wikipedia) {
      // No rating at all (bare OSM row). Google-rated places must win when
      // they are anywhere near, which is what "best of the best nearby" means;
      // this small tax keeps the 250 anonymous rows from burying them while
      // still letting a landmark row compete.
      score -= 4;
    }

    // --- landmark signal: Wikipedia/Wikidata-documented places are notable
    // (OSM rows carry the tag; skipped for keyword hits so intent wins) ---
    if (p.wikipedia && !kwHit) {
      score += 6;
      reasons.push({ key: "landmark" });
    }

    // --- named Japanese speciality ("東京ラーメン 大番", "すし好"): a free,
    // cache-stable signal that separates a real local kitchen from an
    // anonymous storefront, which the rating alone cannot do at equal volume.
    // The kind also feeds the per-kind spread in recommend.ts. ---
    const cuisine = cuisineOf(name, p.tags);
    if (!kwHit && cuisine !== "other" && isLocalCuisine(name)) {
      // +3 is a tiebreaker among unrated rows: at +6 it outranked an actually
      // well-rated neighbour, which is the opposite of "best of the best".
      score += 3;
      reasons.push({ key: "localCuisine" });
    }

    // --- interest keyword: explicit user intent wins over noise rules ---
    if (kwHit) {
      score += 20;
      reasons.push({ key: "keywordMatch", params: { kw: ctx.keyword ?? "" } });
    }

    // --- noise penalties: chains & hotels (skipped when the keyword matched:
    // the user asked for that exact place, e.g. "Sukiya") ---
    if (!kwHit && isChainName(name)) {
      score -= 12;
      reasons.push({ key: "chain" });
    }
    // a ryokan with an onsen is an experience for this user — exempt it
    if (!kwHit && isHotelName(name) && !p.tags.includes("onsen")) {
      score -= 12;
      reasons.push({ key: "hotel" });
    }

    // --- "gente ahora" as a ranking signal (opt-in) ---
    // The one signal Google Maps does not sell. The level is rescaled onto
    // THIS pool's spread (see crowdRank above): in a dense area every
    // candidate is published at 0.93 or 1.00, where an absolute comparison
    // sees almost no difference to rank. Ordering uses the rescaled rank; the
    // reason shown to the user quotes the ABSOLUTE level, so the card and the
    // number can never contradict each other.
    //
    // ponytail: with only two distinct levels in the pool this separates two
    // tiers, not a gradient. Upgrade by deriving real per-hour footfall from
    // the crowd model (curves.ts) instead of the pool-normalized popularity.
    if (ctx.avoidCrowds && ctx.crowd && crowdRank) {
      const pct = crowdRank.get(p.id);
      const level = ctx.crowd.get(p.id)?.level;
      if (pct !== undefined && level !== undefined) {
        score += Math.round(-16 + 24 * pct);
        reasons.push({
          key: level < 0.55 ? "crowdQuiet" : level < 0.85 ? "crowdMild" : "crowdBusy",
        });
      }
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
      // Kept UNCLAMPED: the top candidates all earn well over 100, so clamping
      // here made the first twenty tie at exactly 100 and threw away every
      // signal that separated them (this is what made the order look random).
      // The UI already renders the ring against 100 and floors the overflow.
      score: score,
      distanceKm: Math.round(distanceKm * 10) / 10,
      travelMin: t,
      reasons,
      ...(cuisine !== "other" ? { cuisine } : {}),
    });
  }

  out.sort((a, b) => b.score - a.score || a.travelMin - b.travelMin);
  return out;
}
