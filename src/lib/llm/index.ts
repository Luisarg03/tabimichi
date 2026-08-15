import { activeProviders, type LlmProvider } from "./providers";
import { chatComplete } from "./client";
import type { ScoredPlace, WeatherInfo, TimeBudget, TransportMode } from "../types";

export interface NarrateOpts {
  places: ScoredPlace[];
  weather: WeatherInfo;
  budget: TimeBudget;
  mode: TransportMode;
  lang: string;
  types: string[];
}

const BUDGET_LABEL: Record<string, [string, string]> = {
  lunch: ["almuerzo", "a lunch"],
  afternoon: ["tarde", "an afternoon"],
  full_day: ["día completo", "a full day"],
};

const MODE_LABEL: Record<string, [string, string]> = {
  walking: ["caminando", "on foot"],
  transit: ["en tren/bus", "by train/bus"],
  car: ["en auto", "by car"],
};

function extractJson(text: string): { narratives?: Array<{ id?: string; why?: string }> } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as {
      narratives?: Array<{ id?: string; why?: string }>;
    };
  } catch {
    return null;
  }
}

function buildPrompt(opts: NarrateOpts): { system: string; user: string } {
  const es = opts.lang !== "en";
  const candidates = opts.places.slice(0, 4).map((p) => ({
    id: p.id,
    name: p.name,
    distanceKm: p.distanceKm,
    travelMin: p.travelMin,
    rating: p.rating ?? null,
    tags: p.tags,
  }));

  const system = es
    ? "Sos Tabi, un guía de viaje local experto en Japón. Respondés en español, conciso y específico. Solo JSON, sin texto extra."
    : "You are Tabi, an expert local travel guide for Japan. Answer in English, concise and specific. JSON only, no extra text.";

  const user = es
    ? `Contexto: el usuario explora cerca de su zona con ${BUDGET_LABEL[opts.budget]?.[0] ?? "tiempo"} disponible y se mueve ${MODE_LABEL[opts.mode]?.[0] ?? "de alguna forma"}. Clima: ${opts.weather.label}, ${opts.weather.tempC}°C, sensación ${opts.weather.feelsC}°C. Intereses: ${opts.types.join(", ") || "cualquier cosa"}. Candidatos puntuados: ${JSON.stringify(candidates)}. Redactá para los mejores 3 un "por qué ir hoy" de 1-2 frases cada uno, mencionando algo concreto (clima, momento del día, distancia en su modo de transporte, qué lo hace especial). Respondé SOLO JSON: {"narratives":[{"id":"...","why":"..."}]}`
    : `Context: the user is exploring near their area with ${BUDGET_LABEL[opts.budget]?.[1] ?? "some time"} available and moves ${MODE_LABEL[opts.mode]?.[1] ?? "somehow"}. Weather: ${opts.weather.label}, ${opts.weather.tempC}°C, feels like ${opts.weather.feelsC}°C. Interests: ${opts.types.join(", ") || "anything"}. Scored candidates: ${JSON.stringify(candidates)}. Write a "why go today" of 1-2 sentences for the best 3, mentioning something concrete (weather, time of day, distance in their transport mode, what makes it special). Reply JSON ONLY: {"narratives":[{"id":"...","why":"..."}]}`;

  return { system, user };
}

async function narrateWith(provider: LlmProvider, opts: NarrateOpts): Promise<Map<string, string>> {
  const { system, user } = buildPrompt(opts);
  const raw = await chatComplete(provider, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 700,
    temperature: 0.5,
  });
  const parsed = extractJson(raw);
  const arr = parsed?.narratives;
  if (!Array.isArray(arr)) return new Map();
  const map = new Map<string, string>();
  for (const n of arr) {
    if (n?.id && typeof n.why === "string" && n.why.trim()) map.set(n.id, n.why.trim());
  }
  return map;
}

/**
 * LLM narrative layer (M2): the model narrates *why now* for the top picks.
 * The rules still score; the LLM only writes the story. Tries providers in
 * priority order (each with internal retries). Never throws — on total
 * failure the app falls back to rule-based reasons.
 */
export async function narrateTop(opts: NarrateOpts): Promise<Map<string, string>> {
  const providers = activeProviders();
  if (providers.length === 0) return new Map();
  if (opts.places.length === 0) return new Map();

  for (const provider of providers) {
    try {
      const map = await narrateWith(provider, opts);
      if (map.size > 0) return map;
    } catch {
      // try next provider
    }
  }
  return new Map();
}
