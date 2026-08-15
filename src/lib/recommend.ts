import type { Place, RecommendInput, RecommendResult, TransportMode } from "./types";
import { getWeather, weatherAt } from "./weather";
import { BUDGET_MIN, radiusForBudget } from "./geo";
import { discover } from "./places";
import { scorePlaces } from "./scoring";
import { getProfile } from "./db";
import { getConfig } from "./settings";
import { googlePlaceDetails } from "./places/google";
import { isOpenAt, type OpenPeriod } from "./open-hours";
import { jstHourStamp } from "./jst";

type Candidate = Place & { periods?: OpenPeriod[] };

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
  const mode: TransportMode = input.mode ?? "transit";
  const budgetMin = BUDGET_MIN[input.budget] ?? 300;
  const radiusKm = input.radiusKm ?? radiusForBudget(input.budget, mode);
  const simulated = input.now ? new Date(input.now) : null;

  const [weatherRaw, { places, source }] = await Promise.all([
    getWeather(input.lat, input.lng),
    discover({
      lat: input.lat,
      lng: input.lng,
      radiusKm,
      types: input.types,
      lang: input.lang,
      simulate: simulated !== null,
    }),
  ]);

  const weather = simulated ? weatherAt(weatherRaw, jstHourStamp(simulated)) : weatherRaw;

  // simulation: evaluate open/closed locally at the simulated instant
  let candidates: Candidate[] = places;
  if (simulated) {
    const config = getConfig();
    const enriched = await Promise.all(
      places.slice(0, 10).map(async (p): Promise<Candidate> => {
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
    candidates = enriched;
  }

  const scored = scorePlaces(candidates, {
    base: { lat: input.lat, lng: input.lng },
    budgetMin,
    weather,
    now: simulated ?? new Date(),
    mode,
    // Google Places only biases by radius, so hard-drop results beyond it (50% slack)
    maxDistKm: radiusKm * 1.5,
    profile: getProfile(),
  });

  return {
    weather,
    places: scored.slice(0, 8),
    generatedAt: new Date().toISOString(),
    radiusKm,
    sourceNote: source,
    narrated: false,
  };
}
