import type { EmptyReason, Place, RecommendInput, RecommendResult, ScoredPlace, TransportMode } from "./types";
import { getWeather, weatherAt } from "./weather";
import { RADIUS_KM, haversineKm } from "./geo";
import { discover, normalizePlaceName } from "./places";
import { EXPERIENCE_TYPE_MAP } from "./places/taxonomy";
import { scorePlaces } from "./scoring";
import { getProfile } from "./db";
import { getConfig, type AppConfig } from "./settings";
import { googlePlaceDetails } from "./places/google";
import { isOpenAt, type OpenPeriod } from "./open-hours";
import { jstHourStamp, localTimeAt } from "./jst";
import { logEntry, newTraceId } from "./logger";
import { keywordTokens, normalizeKeyword } from "./keywords";
import { translateEsEn } from "./translate";
import { crowdForPool, type CrowdPoolPlace } from "./crowd";

type Candidate = Place & { periods?: OpenPeriod[] };

export interface RecommendOptions extends RecommendInput {
  /** debug only: how many places to return. Defaults to RESULT_LIMIT (the UI
   *  cap). Raising it exposes the full ranked pool so the ranking can be
   *  measured with `scripts/ranking.bench.ts` without the top-30 cut hiding
   *  whether the order itself is right. */
  poolLimit?: number;
  /** the requesting user's API keys (BYOK) — empty for anonymous */
  config?: AppConfig;
  /** signed-in user id — their own crowd reports feed the "gente ahora" estimate */
  userId?: string | null;
}

/**
 * How many places the user sees. "Llenar de opciones y que el usuario decida"
 * is the product's core value — discovery now returns a big merged pool, so
 * the UI shows a generous slice of the scored top instead of just 10.
 */
export const RESULT_LIMIT = 30;

/**
 * Spread the top picks so the list shows variety instead of near-clones.
 * Two grouping levels:
 *   1. experience type (a park, a museum, a shrine, food…) — the generic
 *      "discover" case;
 *   2. inside food, the restaurant KIND from the name (ramen, sushi, soba,
 *      cafe…) — without it a single-type search buckets everything together
 *      and the spatial guard alone cannot stop five ramen shops in a row.
 * Within a bucket score order is preserved; the global best still comes first.
 * Spatial guard: a candidate hugging an already-picked same-bucket place
 * (within 150 m) is deferred to a later round instead of dropped — the list
 * spreads over the map without silently removing real local businesses.
 */
const SAME_TAG_SPREAD_KM = 0.15;

function bucketKey(p: { tags: string[]; cuisine?: string }): string {
  const tag = p.tags[0] ?? "other";
  return tag === "food" && p.cuisine ? `food:${p.cuisine}` : tag;
}

export function diversify<T extends { tags: string[]; lat?: number; lng?: number; cuisine?: string }>(
  scored: T[],
  limit: number
): T[] {
  const byTag = new Map<string, T[]>();
  for (const p of scored) {
    const tag = bucketKey(p);
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag)!.push(p);
  }
  const out: T[] = [];
  const pickedByTag = new Map<string, T[]>();
  const keys = [...byTag.keys()];
  let guard = 0;
  while (out.length < limit && guard++ <= scored.length + limit) {
    let added = false;
    for (const k of keys) {
      const list = byTag.get(k)!;
      if (list.length === 0) continue;
      const picked = pickedByTag.get(k) ?? [];
      // prefer a candidate that is not on top of an already-picked same-type
      // place; when everything clusters (or coords are unknown), take the
      // best remaining one
      const tooClose = (p: T, q: T): boolean =>
        p.lat !== undefined && p.lng !== undefined && q.lat !== undefined && q.lng !== undefined
          ? haversineKm({ lat: p.lat, lng: p.lng }, { lat: q.lat, lng: q.lng }) <= SAME_TAG_SPREAD_KM
          : false;
      let idx = list.findIndex((p) => !picked.some((q) => tooClose(p, q)));
      if (idx === -1) idx = 0;
      const [p] = list.splice(idx, 1);
      picked.push(p);
      pickedByTag.set(k, picked);
      out.push(p);
      added = true;
      if (out.length >= limit) break;
    }
    if (!added) break;
  }
  return out;
}

/**
 * End-to-end recommendation pipeline — fast path only (rules).
 * Weather and discovery run in parallel; the LLM narrative is a separate
 * async phase (/api/narrate) so the user sees results immediately.
 *
 * `input.now` (ISO) switches to time-simulation: discovery keeps closed
 * places as candidates, structured opening hours are fetched for the top
 * candidates and open/closed is evaluated at the simulated instant, and the
 * weather is taken from the hourly forecast at that hour.
 */
export async function recommend(input: RecommendOptions): Promise<RecommendResult> {
  const startedAt = performance.now();
  const mode: TransportMode = input.mode ?? "transit";
  const radiusKm = input.radiusKm ?? RADIUS_KM[mode];
  // poolLimit is debug-only; 300 is the cache pool cap, so it can never ask
  // for more than discovery could have produced.
  const limit = Math.max(1, Math.min(input.poolLimit ?? RESULT_LIMIT, 300));
  const simulated = input.now ? new Date(input.now) : null;
  // optional interest keyword — normalized once here. The raw term goes to
  // Google as-is; single Spanish words ("gatos") are translated by the free
  // MyMemory API (cached). Multi-word keywords ("cafe, neko", "book off")
  // are NEVER translated — MyMemory would mangle words that exist in both
  // languages ("cafe" → "coffee") and Google handles the phrase natively.
  const keyword = input.keyword ? normalizeKeyword(input.keyword) : undefined;
  const translated = keyword && !keyword.includes(" ") ? await translateEsEn(keyword) : undefined;
  // Spanish interest words describe THEMED PLACES: "gatos" → "cat cafe", not
  // "cat" (Google reads "cat" as pet shops). The ' cafe' suffix only applies
  // to translated terms — raw keywords ("snoopy", "book off", "cafe, neko")
  // keep their own query.
  const searchTerm =
    translated && translated !== keyword
      ? `${translated} cafe`
      : keyword;
  const kwTerms = keyword
    ? [...keywordTokens(keyword), ...(translated && translated !== keyword ? keywordTokens(translated) : [])]
    : undefined;

  const [weatherRaw, { places, source, keywordResults, sources }] = await Promise.all([
    getWeather(input.lat, input.lng),
    discover({
      lat: input.lat,
      lng: input.lng,
      radiusKm,
      types: input.types,
      lang: input.lang,
      keyword: searchTerm,
      config: input.config,
    }),
  ]);

  const weather = simulated ? weatherAt(weatherRaw, jstHourStamp(simulated)) : weatherRaw;

  // Pinned place (the exact place the user searched): joins the candidate
  // pool so scoring sees it, but is exempt from hard filters and later moved
  // to the front — Google Maps shows the searched place, always.
  const pin = input.pin
    ? { ...input.pin, name: input.pin.name.trim().slice(0, 120) }
    : undefined;
  const pinPlace: Candidate | undefined = pin
    ? {
        id: `pin_${pin.lat.toFixed(4)}_${pin.lng.toFixed(4)}`,
        source: "overpass",
        name: pin.name,
        lat: pin.lat,
        lng: pin.lng,
        tags: EXPERIENCE_TYPE_MAP[pin.typeId ?? ""] ? [pin.typeId!] : ["other"],
        openNow: null,
        fromKeyword: true,
      }
    : undefined;

  // simulation: evaluate open/closed locally at the simulated instant.
  // Enrich the NEAREST candidates first (details calls are limited) and merge
  // the results back — never discard candidates outside the enriched slice.
  let candidates: Candidate[] = pinPlace ? [...places, pinPlace] : places;
  if (simulated) {
    const config = input.config ?? getConfig();
    const base = { lat: input.lat, lng: input.lng };
    const byDistance = [...candidates].sort(
      (a, b) => haversineKm(base, a) - haversineKm(base, b)
    );
    const enriched = await Promise.all(
      byDistance.slice(0, 10).map(async (p): Promise<Candidate> => {
        if (p.source !== "google") return { ...p, openNow: null }; // hours unknown
        const gid = p.id.startsWith("g_") ? p.id.slice(2) : p.id;
        try {
          const { periods } = await googlePlaceDetails(config.googlePlacesApiKey!, gid);
          return { ...p, periods, openNow: isOpenAt(periods, simulated) };
        } catch {
          return { ...p, openNow: null };
        }
      })
    );
    const enrichedById = new Map(enriched.map((p) => [p.id, p]));
    candidates = candidates.map((p) => enrichedById.get(p.id) ?? { ...p, openNow: null });
  }

  const profile = getProfile();
  const stats = { closed: 0, tooFar: 0, nameMatches: 0, noise: 0 };
  // Destination-local wall clock in UTC fields: simulated dates already are
  // (JST convention); real instants get shifted by the longitude offset.
  const scoringNow = simulated ?? localTimeAt(new Date(), input.lng);
  // ---- "gente ahora": how busy each place is right now ------------------
  // Computed BEFORE scoring (it used to run after): the crowd estimate is the
  // one signal Google Maps does not sell, so when the user asks to avoid the
  // crowds it has to move the order, not just decorate the card. Popularity is
  // relative to the pool, so it is one pass over every candidate; only what
  // the user sees gets the badge attached.
  const crowdPool: CrowdPoolPlace[] = candidates.map((p) => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    tags: p.tags,
    userRatingsTotal: p.userRatingsTotal,
    wikipedia: p.wikipedia,
    periods: p.periods,
  }));
  const { byId: crowdById, cells: crowdCellList, zones: crowdZoneList } = await crowdForPool(crowdPool, {
    now: scoringNow,
    lat: input.lat,
    lng: input.lng,
    weather,
    userId: input.userId ?? null,
  });

  const scored = scorePlaces(candidates, {
    base: { lat: input.lat, lng: input.lng },
    weather,
    now: scoringNow,
    mode,
    // Google Places only biases by radius, so hard-drop results beyond it (50% slack)
    maxDistKm: radiusKm * 1.5,
    // real mode: closed places stay as candidates with a badge + penalty
    // (simulation keeps the hard filter so the simulator is precise)
    softClosed: !simulated,
    keyword,
    keywordTerms: kwTerms,
    profile,
    stats,
    pinnedIds: pinPlace ? new Set([pinPlace.id]) : undefined,
    // the user's standing preference: "gente ahora" moves the order.
    // Default off — the estimate is a model, not a measurement, so it only
    // ranks when the user explicitly asked to avoid the crowds.
    crowd: input.avoidCrowds ? crowdById : undefined,
    avoidCrowds: input.avoidCrowds === true,
  });

  // With an interest keyword the user's intent wins: candidates that came
  // from the keyword query itself (or match its name) rank first —
  // weather/rating noise can't bury them; then the rest by score.
  const kwMiss = Boolean(keyword) && (keywordResults ?? 0) === 0;
  let top: ScoredPlace[];
  if (keyword && !kwMiss) {
    // intent order: Google's own keyword-query results first (e.g. Neko Cafe
    // Naru is Google's rank 1 for "cafe neko"), then name matches from the
    // generic pool (any cafe with 'cafe' in its name), then the rest
    const fromQuery = scored.filter((p) => p.fromKeyword);
    const nameOnly = scored.filter(
      (p) => !p.fromKeyword && p.reasons.some((r) => r.key === "keywordMatch")
    );
    const rest = scored.filter(
      (p) => !p.fromKeyword && !p.reasons.some((r) => r.key === "keywordMatch")
    );
    top = [...fromQuery, ...nameOnly, ...rest].slice(0, limit);
  } else {
    top = diversify(scored, limit).sort(
      (a, b) => b.score - a.score || a.travelMin - b.travelMin
    );
  }

  // Pinned place first, always: prefer the source-enriched twin (Google's
  // record with rating/photos) when discovery also found it — that keeps
  // rich data while the pin guarantees presence; synthesize as last resort
  // (every source failed and the pool is empty).
  if (pinPlace) {
    const twin = scored.find(
      (p) =>
        p.id !== pinPlace.id &&
        normalizePlaceName(p.name) === normalizePlaceName(pinPlace.name) &&
        Math.abs(p.lat - pinPlace.lat) < 0.002 &&
        Math.abs(p.lng - pinPlace.lng) < 0.002
    );
    const chosen = twin ?? scored.find((p) => p.id === pinPlace.id);
    if (chosen) {
      top = [
        { ...chosen, reasons: [{ key: "pinned" }, ...chosen.reasons] },
        ...top.filter((p) => p.id !== chosen.id && p.id !== pinPlace.id),
      ].slice(0, limit);
    } else {
      top = [
        {
          ...pinPlace,
          score: top.length > 0 ? Math.max(top[0].score, 50) : 50,
          distanceKm: 0,
          travelMin: 0,
          reasons: [{ key: "pinned" }],
        },
        ...top,
      ].slice(0, limit);
    }
  }
  const emptyReason = emptyReasonFor(candidates, top.length);

  // Zone display names: busiest member place (placeIds arrive busiest
  // first). Names already travelled here with the candidates — no new lookup.
  const placesWithCrowd: ScoredPlace[] = top.map((p) => {
    const crowd = crowdById.get(p.id);
    return crowd ? { ...p, crowd } : p;
  });
  const names = new Map(candidates.map((p) => [p.id, p.name]));

  // ---- the contrast pick -------------------------------------------------
  // "The best is #1; if you want it quiet, go here." The crowd estimate is
  // already computed for the whole pool, so this costs nothing — and it is the
  // one answer a popularity-ranked directory cannot give.
  //
  // Rules, deliberately strict so it never becomes noise:
  //   - a real difference (at least 0.1 on the 0..1 scale),
  //   - within 15 min extra of the top pick (a quiet place across town is a
  //     different trip, not an alternative),
  //   - same value class: it must be rated (no sending someone to an unknown
  //     place just because it is empty).
  const quietPick = pickQuietAlternative(placesWithCrowd);
  const namedZones = crowdZoneList.map((z) => ({
    ...z,
    name: names.get(z.placeIds[0] ?? ""),
  }));

  const traceId = newTraceId();
  const summary = {
    traceId,
    lat: input.lat,
    lng: input.lng,
    types: input.types,
    mode,
    sim: simulated !== null,
    source,
    sources: sources ?? [source],
    candidates: candidates.length,
    filters: { closed: stats.closed, tooFar: stats.tooFar, nameMatches: stats.nameMatches, noise: stats.noise },
    scored: top.length,
    emptyReason,
    keyword,
    keywordResults: keywordResults ?? 0,
    keywordMiss: kwMiss,
    pin: pin?.name,
    weather: { condition: weather.condition, tempC: weather.tempC, precipMm: weather.precipMm },
    profile,
    radiusKm,
    ms: Math.round(performance.now() - startedAt),
  };
  console.log("[tabi] recommend", JSON.stringify(summary));
  logEntry({
    type: "recommend",
    ...summary,
    top: placesWithCrowd.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      distanceKm: p.distanceKm,
      travelMin: p.travelMin,
      openNow: p.openNow,
      reasons: p.reasons.map((r) => r.key),
      crowd: p.crowd ? { level: Number(p.crowd.level.toFixed(2)), label: p.crowd.label } : undefined,
    })),
    crowdCells: crowdCellList.length,
    hotZones: namedZones.map((z) => ({
      lat: z.lat,
      lng: z.lng,
      weight: z.weight,
      label: z.label,
      places: z.placeIds.length,
      name: z.name,
    })),
  });

  return {
    weather,
    places: placesWithCrowd,
    generatedAt: new Date().toISOString(),
    radiusKm,
    sourceNote: source,
    sources: sources ?? [source],
    narrated: false,
    emptyReason,
    traceId,
    keyword,
    keywordResults: keywordResults ?? 0,
    keywordMiss: kwMiss,
    crowdCells: crowdCellList,
    hotZones: namedZones,
    crowdAt: scoringNow.toISOString(),
    ...(quietPick ? { quietPick } : {}),
  };
}

/**
 * Classify an empty result so the UI can say *why*:
 *  - no_results: sources returned nothing
 *  - all_closed: candidates existed but every one is closed right now
 *  - too_far: candidates exist but all fall outside distance/mode reach
 */
/**
 * The contrast answer: given the ranked list, which place is the quieter
 * alternative worth naming? Pure so it can be tested directly.
 *
 * Rules, deliberately strict so it never becomes noise:
 *   - a real difference (>= 0.1 on the 0..1 crowd scale),
 *   - within 15 min extra of the top pick (a quiet place across town is a
 *     different trip, not an alternative),
 *   - it must be RATED: never send someone to an unknown place just because
 *     nobody is there.
 */
export function pickQuietAlternative(
  ranked: ScoredPlace[]
): { id: string; extraMin: number; level: number } | undefined {
  const best = ranked[0];
  if (!best?.crowd) return undefined;
  let candidate: { p: ScoredPlace; extraMin: number } | undefined;
  for (const p of ranked.slice(1)) {
    if (!p.crowd || p.rating === undefined) continue;
    if (best.crowd.level - p.crowd.level < 0.1) continue;
    const extraMin = p.travelMin - best.travelMin;
    if (extraMin > 15) continue;
    if (!candidate || p.crowd.level < candidate.p.crowd!.level) candidate = { p, extraMin };
  }
  if (!candidate) return undefined;
  return { id: candidate.p.id, extraMin: Math.max(0, candidate.extraMin), level: candidate.p.crowd!.level };
}

export function emptyReasonFor(candidates: Candidate[], scoredCount: number): EmptyReason | undefined {
  if (candidates.length === 0) return "no_results";
  if (scoredCount > 0) return undefined;
  const closed = candidates.filter((p) => p.openNow === false).length;
  return closed > 0 ? "all_closed" : "too_far";
}
