import type { RecommendInput, RecommendResult, TransportMode } from "./types";
import { getWeather } from "./weather";
import { BUDGET_MIN, radiusForBudget } from "./geo";
import { discover } from "./places";
import { scorePlaces } from "./scoring";
import { narrateTop } from "./llm";

/** End-to-end recommendation pipeline (rules score, LLM narrates). */
export async function recommend(input: RecommendInput): Promise<RecommendResult> {
  const mode: TransportMode = input.mode ?? "transit";
  const weather = await getWeather(input.lat, input.lng);
  const budgetMin = BUDGET_MIN[input.budget] ?? 300;
  const radiusKm = input.radiusKm ?? radiusForBudget(input.budget, mode);

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
    mode,
    // Google Places only biases by radius, so hard-drop results beyond it (50% slack)
    maxDistKm: radiusKm * 1.5,
  });

  const top = scored.slice(0, 8);
  let narrated = false;
  let narratedBy: string | undefined;
  let summary: string | undefined;

  if (input.narrate && top.length > 0) {
    const { narratives, summary: daySummary, provider } = await narrateTop({
      places: top,
      weather,
      budget: input.budget,
      mode,
      lang: input.lang ?? "es",
      types: input.types,
    });
    if (narratives.size > 0 || daySummary) {
      narrated = true;
      narratedBy = provider;
      summary = daySummary;
      for (const p of top) {
        const why = narratives.get(p.id);
        if (why) p.why = why;
      }
    }
  }

  return {
    weather,
    places: top,
    generatedAt: new Date().toISOString(),
    radiusKm,
    sourceNote: source,
    narrated,
    narratedBy,
    summary,
  };
}
