import { getConfig, type AppConfig } from "../settings";

/**
 * LLM provider registry (M2).
 * Two layers, both OpenAI-compatible gateways reachable with just an API key
 * (the keys are requested in the app's Settings and never leave the machine):
 *
 *   - opencode-zen (free tier)  → https://opencode.ai/zen/v1
 *       free model: deepseek-v4-flash-free (shared quota → rate-limited often)
 *   - opencode-go  (paid tier)  → https://opencode.ai/zen/go/v1
 *       models: deepseek-v4-flash, deepseek-v4-pro, mimo-v2.5, minimax-m3
 *
 * Strategy: try the free layer first, fall back to the paid layer.
 * New providers (OpenRouter, NVIDIA NIM, Ollama, OmniRoute…) are entries here.
 */

export interface LlmProvider {
  id: string;
  name: string;
  tier: "free" | "paid";
  baseURL: string;
  apiKey: string;
  models: string[];
}

/** Free layer: OpenCode Zen. */
const ZEN: Omit<LlmProvider, "apiKey"> = {
  id: "opencode-zen",
  name: "OpenCode Zen",
  tier: "free",
  baseURL: "https://opencode.ai/zen/v1",
  models: ["deepseek-v4-flash-free", "deepseek-v4-flash"],
};

/** Paid layer: OpenCode Go. */
const GO: Omit<LlmProvider, "apiKey"> = {
  id: "opencode-go",
  name: "OpenCode Go",
  tier: "paid",
  baseURL: "https://opencode.ai/zen/go/v1",
  models: ["deepseek-v4-flash", "deepseek-v4-pro", "mimo-v2.5", "minimax-m3"],
};

/** Providers with a configured key, free layer first (fallback order). */
export function activeProviders(config?: AppConfig): LlmProvider[] {
  const cfg = config ?? getConfig();
  const out: LlmProvider[] = [];
  if (cfg.opencodeApiKey) out.push({ ...ZEN, apiKey: cfg.opencodeApiKey });
  if (cfg.opencodeGoApiKey) out.push({ ...GO, apiKey: cfg.opencodeGoApiKey });
  return out;
}
