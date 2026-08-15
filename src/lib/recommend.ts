import type { RecommendInput, RecommendResult, TransportMode } from "./types";
import { getWeather } from "./weather";
import { BUDGET_MIN, radiusForBudget } from "./geo";
import { discover } from "./places";
import { scorePlaces } from "./scoring";
import { getProfile } from "./db";

/**
 * End-to-end recommendation pipeline — fast path only (rules).
 * Weather and discovery run in parallel; the LLM narrative is a separate
 * async phase (/api/narrate) so the user sees results immediately.
 */
export async function recommend(input: RecommendInput): Promise<RecommendResult> {
  const mode: TransportMode = input.mode ?? "transit";
  const budgetMin = BUDGET_MIN[input.budget] ?? 300;
  const radiusKm = input.radiusKm ?? radiusForBudget(input.budget, mode);

  const [weather, { places, source }] = await Promise.all([
    getWeather(input.lat, input.lng),
    discover({
      lat: input.lat,
      lng: input.lng,
      radiusKm,
      types: input.types,
      lang: input.lang,
    }),
  ]);

  const scored = scorePlaces(places, {
    base: { lat: input.lat, lng: input.lng },
    budgetMin,
    weather,
    now: new Date(),
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
