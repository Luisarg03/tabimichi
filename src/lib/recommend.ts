import type { EmptyReason, Place, RecommendInput, RecommendResult, TransportMode } from "./types";
import { getWeather, weatherAt } from "./weather";
import { BUDGET_MIN, radiusForBudget, haversineKm } from "./geo";
import { discover } from "./places";
import { scorePlaces } from "./scoring";
import { getProfile } from "./db";
import { getConfig } from "./settings";
import { googlePlaceDetails } from "./places/google";
import { isOpenAt, type OpenPeriod } from "./open-hours";
import { jstHourStamp } from "./jst";
import { logEntry, newTraceId } from "./logger";
import { normalizeKeyword, searchTermFor } from "./keywords";

type Candidate = Place & { periods?: OpenPeriod[] };

/**
 * Spread the top picks across experience types so a generic "discover" shows
 * variety (a park, a museum, a shrine, food...) instead of 10 similar places.
 * Within each type, score order is preserved; the global best still comes first.
 * Single-type searches are unaffected (one bucket).
 */
export function diversify<T extends { tags: string[] }>(scored: T[], limit: number): T[] {
  const byTag = new Map<string, T[]>();
  for (const p of scored) {
    const tag = p.tags[0] ?? "other";
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag)!.push(p);
  }
  const out: T[] = [];
  const keys = [...byTag.keys()];
  while (out.length < limit) {
    let added = false;
    for (const k of keys) {
      const list = byTag.get(k)!;
      if (list.length === 0) continue;
      out.push(list.shift()!);
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
export async function recommend(input: RecommendInput): Promise<RecommendResult> {
  const startedAt = performance.now();
  const mode: TransportMode = input.mode ?? "transit";
  const budgetMin = BUDGET_MIN[input.budget] ?? 300;
  const radiusKm = input.radiusKm ?? radiusForBudget(input.budget, mode);
  const simulated = input.now ? new Date(input.now) : null;
  // optional interest keyword — normalized once here, drives discovery + scoring
  // (discovery gets the alias-expanded search term, scoring the user's word)
  const keyword = input.keyword ? normalizeKeyword(input.keyword) : undefined;
  const searchTerm = keyword ? searchTermFor(keyword) : undefined;

  const [weatherRaw, { places, source }] = await Promise.all([
    getWeather(input.lat, input.lng),
    discover({
      lat: input.lat,
      lng: input.lng,
      radiusKm,
      types: input.types,
      lang: input.lang,
      keyword: searchTerm,
    }),
  ]);

  const weather = simulated ? weatherAt(weatherRaw, jstHourStamp(simulated)) : weatherRaw;

  // simulation: evaluate open/closed locally at the simulated instant.
  // Enrich the NEAREST candidates first (details calls are limited) and merge
  // the results back — never discard candidates outside the enriched slice.
  let candidates: Candidate[] = places;
  if (simulated) {
    const config = getConfig();
    const base = { lat: input.lat, lng: input.lng };
    const byDistance = [...places].sort(
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
    candidates = places.map((p) => enrichedById.get(p.id) ?? { ...p, openNow: null });
  }

  const profile = getProfile();
  const stats = { closed: 0, tooFar: 0, nameMatches: 0 };
  const scored = scorePlaces(candidates, {
    base: { lat: input.lat, lng: input.lng },
    budgetMin,
    weather,
    now: simulated ?? new Date(),
    mode,
    // Google Places only biases by radius, so hard-drop results beyond it (50% slack)
    maxDistKm: radiusKm * 1.5,
    // real mode: closed places stay as candidates with a badge + penalty
    // (simulation keeps the hard filter so the simulator is precise)
    softClosed: !simulated,
    keyword,
    profile,
    stats,
  });

  // diversify keeps the SET varied (no 6 parks out of 10); sorting after
  // keeps the displayed order clean — best score first, ties by travel time
  const top = diversify(scored, 10).sort(
    (a, b) => b.score - a.score || a.travelMin - b.travelMin
  );
  const emptyReason = emptyReasonFor(candidates, top.length);

  const traceId = newTraceId();
  const summary = {
    traceId,
    lat: input.lat,
    lng: input.lng,
    budget: input.budget,
    types: input.types,
    mode,
    sim: simulated !== null,
    source,
    candidates: candidates.length,
    filters: { closed: stats.closed, tooFar: stats.tooFar, nameMatches: stats.nameMatches },
    scored: top.length,
    emptyReason,
    keyword,
    weather: { condition: weather.condition, tempC: weather.tempC, precipMm: weather.precipMm },
    profile,
    radiusKm,
    ms: Math.round(performance.now() - startedAt),
  };
  console.log("[tabi] recommend", JSON.stringify(summary));
  logEntry({
    type: "recommend",
    ...summary,
    top: top.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      distanceKm: p.distanceKm,
      travelMin: p.travelMin,
      openNow: p.openNow,
      reasons: p.reasons.map((r) => r.key),
    })),
  });

  return {
    weather,
    places: top,
    generatedAt: new Date().toISOString(),
    radiusKm,
    sourceNote: source,
    narrated: false,
    emptyReason,
    traceId,
  };
}

/**
 * Classify an empty result so the UI can say *why*:
 *  - no_results: sources returned nothing
 *  - all_closed: candidates existed but every one is closed right now
 *  - too_far: candidates exist but all fall outside distance/budget
 */
export function emptyReasonFor(candidates: Candidate[], scoredCount: number): EmptyReason | undefined {
  if (candidates.length === 0) return "no_results";
  if (scoredCount > 0) return undefined;
  const closed = candidates.filter((p) => p.openNow === false).length;
  return closed > 0 ? "all_closed" : "too_far";
}
