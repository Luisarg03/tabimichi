/**
 * AppConfig — the shape of provider credentials the app can spend.
 *
 * BYOK: at request time keys come exclusively from the authenticated user's
 * rows in Supabase `api_keys` (see src/lib/user-keys.ts). There is no
 * operator env fallback — anonymous requests are keyless by design.
 *
 * `getConfig()` (env vars) survives only as a fixture seam for tests and
 * defaults for code paths that receive no explicit config; in a BYOK
 * deployment those env vars are never set, so it returns an empty config.
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