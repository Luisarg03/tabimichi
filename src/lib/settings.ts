/**
 * Server-side settings. API keys come exclusively from environment variables
 * (per-environment on Vercel) or per-user rows in Supabase `api_keys`.
 * There is no local config file.
 */

export interface AppConfig {
  googlePlacesApiKey: string;
  opencodeApiKey: string; // OpenCode Zen
  opencodeGoApiKey: string; // OpenCode Go
  geoapifyApiKey: string; // free tier, no credit card
  overpassEndpoint: string; // custom Overpass instance (e.g. self-hosted osm3s)
}

export const ENV_KEYS: Record<keyof AppConfig, string> = {
  googlePlacesApiKey: "GOOGLE_PLACES_API_KEY",
  opencodeApiKey: "OPENCODE_API_KEY",
  opencodeGoApiKey: "OPENCODE_GO_API_KEY",
  geoapifyApiKey: "GEOAPIFY_API_KEY",
  overpassEndpoint: "OVERPASS_ENDPOINT",
};

const DEFAULT_CONFIG: AppConfig = {
  googlePlacesApiKey: "",
  opencodeApiKey: "",
  opencodeGoApiKey: "",
  geoapifyApiKey: "",
  overpassEndpoint: "",
};

/** Resolved config: read exclusively from environment variables. */
export function getConfig(): AppConfig {
  const out: AppConfig = { ...DEFAULT_CONFIG };
  for (const [key, env] of Object.entries(ENV_KEYS)) {
    const v = process.env[env];
    if (v) out[key as keyof AppConfig] = v;
  }
  return out;
}