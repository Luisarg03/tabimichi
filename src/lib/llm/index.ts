import { activeProviders, type LlmProvider } from "./providers";
import { chatComplete } from "./client";
import type { ScoredPlace, WeatherInfo, TimeBudget, TransportMode } from "../types";
import type { AppConfig } from "../settings";

export interface NarrateOpts {
  places: ScoredPlace[];
  weather: WeatherInfo;
  budget: TimeBudget;
  mode: TransportMode;
  lang: string;
  types: string[];
  /** optional interest keyword: the guide tailors the summary to it */
  keyword?: string;
  /** per-user API keys — avoids reading from shared process.env */
  config?: AppConfig;
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

export function extractJson(text: string): {
  summary?: string;
  narratives?: Array<{ id?: string; why?: string }>;
} | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as {
      summary?: string;
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
    ? `Contexto: el usuario explora cerca de su zona con ${BUDGET_LABEL[opts.budget]?.[0] ?? "tiempo"} disponible y se mueve ${MODE_LABEL[opts.mode]?.[0] ?? "de alguna forma"}. Clima: ${opts.weather.label}, ${opts.weather.tempC}°C, sensación ${opts.weather.feelsC}°C. Intereses: ${opts.types.join(", ") || "cualquier cosa"}${opts.keyword ? `. Interés específico del usuario: "${opts.keyword}" — priorizalo en el resumen` : ""}. Candidatos puntuados: ${JSON.stringify(candidates)}. Redactá para los mejores 3 un "por qué ir hoy" de 1-2 frases cada uno, mencionando algo concreto (clima, momento del día, distancia en su modo de transporte, qué lo hace especial). Además escribí un resumen general de 2-3 frases del plan ideal para el día con estos candidatos. Respondé SOLO JSON: {"summary":"...","narratives":[{"id":"...","why":"..."}]}`
    : `Context: the user is exploring near their area with ${BUDGET_LABEL[opts.budget]?.[1] ?? "some time"} available and moves ${MODE_LABEL[opts.mode]?.[1] ?? "somehow"}. Weather: ${opts.weather.label}, ${opts.weather.tempC}°C, feels like ${opts.weather.feelsC}°C. Interests: ${opts.types.join(", ") || "anything"}${opts.keyword ? `. User's specific interest: "${opts.keyword}" — prioritize it in the summary` : ""}. Scored candidates: ${JSON.stringify(candidates)}. Write a "why go today" of 1-2 sentences for the best 3, mentioning something concrete (weather, time of day, distance in their transport mode, what makes it special). Also write a 2-3 sentence general summary of the ideal day plan with these candidates. Reply JSON ONLY: {"summary":"...","narratives":[{"id":"...","why":"..."}]}`;

  return { system, user };
}

export interface NarrateResult {
  narratives: Map<string, string>;
  /** day-plan summary (2-3 sentences), when the model provided one */
  summary?: string;
  /** which provider narrated: "opencode-zen" | "opencode-go" */
  provider?: string;
}

async function narrateWith(
  provider: LlmProvider,
  opts: NarrateOpts
): Promise<{ narratives: Map<string, string>; summary?: string }> {
  // retry once: the gateway can truncate longer JSON output — a second attempt
  // (with the same prompt) often lands a complete parse
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { system, user } = buildPrompt(opts);
      const raw = await chatComplete(provider, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxTokens: 1200,
        temperature: 0.5,
        // the outer loop already retries — don't nest a second 5xx retry chain
        // (chatComplete default would make up to 6 HTTP attempts per provider)
        retries: 1,
      });
      const parsed = extractJson(raw);
      const arr = parsed?.narratives;
      const map = new Map<string, string>();
      if (Array.isArray(arr)) {
        for (const n of arr) {
          if (n?.id && typeof n.why === "string" && n.why.trim()) map.set(n.id, n.why.trim());
        }
      }
      const summary = typeof parsed?.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : undefined;
      if (map.size > 0 || summary) return { narratives: map, summary };
      throw new Error("llm-unparseable");
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("llm-unparseable");
}

/**
 * LLM narrative layer (M2): the model narrates *why now* for the top picks
 * plus a day-plan summary. The rules still score; the LLM only writes.
 * Tries providers in priority order (free zen first, paid go second; each
 * with internal retries). Never throws — on total failure the app falls back
 * to rule-based reasons.
 */
export async function narrateTop(opts: NarrateOpts): Promise<NarrateResult> {
  const providers = activeProviders(opts.config);
  if (providers.length === 0) return { narratives: new Map() };
  if (opts.places.length === 0) return { narratives: new Map() };

  for (const provider of providers) {
    try {
      const { narratives, summary } = await narrateWith(provider, opts);
      if (narratives.size > 0 || summary) return { narratives, summary, provider: provider.id };
    } catch (err) {
      // log for debugging (the UI falls back to rule reasons)
      console.warn(`[tabi] narrate failed on ${provider.id}:`, (err as Error).message);
    }
  }
  return { narratives: new Map() };
}
