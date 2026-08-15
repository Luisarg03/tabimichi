import type { RecommendInput, RecommendResult } from "./types";
import { getWeather } from "./weather";
import { BUDGET_MIN, radiusForBudget } from "./geo";
import { discover } from "./places";
import { scorePlaces } from "./scoring";

/** End-to-end recommendation pipeline (M1: rules only). */
export async function recommend(input: RecommendInput): Promise<RecommendResult> {
  const weather = await getWeather(input.lat, input.lng);
  const budgetMin = BUDGET_MIN[input.budget] ?? 300;
  const radiusKm = input.radiusKm ?? radiusForBudget(input.budget);

  const { places, source } = await discover({
    lat: input.lat,
    lng: input.lng,
    radiusKm,
    types: input.types,
  });

  const scored = scorePlaces(places, {
    base: { lat: input.lat, lng: input.lng },
    budgetMin,
    weather,
    now: new Date(),
  });

  return {
    weather,
    places: scored.slice(0, 8),
    generatedAt: new Date().toISOString(),
    radiusKm,
    sourceNote: source,
  };
}
