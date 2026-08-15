import { getConfig } from "../settings";

/**
 * LLM provider registry (M2).
 * Providers are OpenAI-compatible gateways reachable with just an API key —
 * the key is requested in the app's Settings and never leaves the machine.
 * New providers (OpenRouter, NVIDIA NIM, Ollama, OmniRoute…) are just entries here.
 */

export interface LlmProvider {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  models: string[];
}

const GATEWAY = "https://opencode.ai/zen/go/v1";

const DEFAULT_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro", "minimax-m3"];

/** Providers with a configured key, in priority order. */
export function activeProviders(): LlmProvider[] {
  const cfg = getConfig();
  const out: LlmProvider[] = [];
  if (cfg.opencodeApiKey) {
    out.push({
      id: "opencode-zen",
      name: "OpenCode Zen",
      baseURL: GATEWAY,
      apiKey: cfg.opencodeApiKey,
      models: DEFAULT_MODELS,
    });
  }
  if (cfg.opencodeGoApiKey) {
    out.push({
      id: "opencode-go",
      name: "OpenCode Go",
      baseURL: GATEWAY,
      apiKey: cfg.opencodeGoApiKey,
      models: DEFAULT_MODELS,
    });
  }
  return out;
}

export function defaultProvider(): LlmProvider | null {
  return activeProviders()[0] ?? null;
}

/** Whether any LLM provider is configured. */
export function hasLlm(): boolean {
  return activeProviders().length > 0;
}
