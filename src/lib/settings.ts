import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Local settings storage. Keys live in <project>/data/config.json
 * (gitignored) and can be overridden by environment variables.
 * Keys are never exposed by the API — only "has key" booleans.
 */

export interface AppConfig {
  googlePlacesApiKey: string;
  opencodeApiKey: string; // OpenCode Zen
  opencodeGoApiKey: string; // OpenCode Go
  geoapifyApiKey: string; // free tier, no credit card
  overpassEndpoint: string; // custom Overpass instance (e.g. self-hosted osm3s)
}

let configPath = path.join(
  process.env.TABI_DATA_DIR ?? path.join(process.cwd(), "data"),
  "config.json"
);

/** Testability: point the config file elsewhere (or restore the default). */
export function setConfigPath(p: string): void {
  configPath = p;
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

function readFile(): AppConfig {
  try {
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf8"));
      return { ...DEFAULT_CONFIG, ...raw };
    }
  } catch {
    // corrupted config — fall back to defaults
  }
  return { ...DEFAULT_CONFIG };
}

/** Resolved config: env vars take precedence over the local file. */
export function getConfig(): AppConfig {
  const file = readFile();
  const out: AppConfig = { ...file };
  for (const [key, env] of Object.entries(ENV_KEYS)) {
    const v = process.env[env];
    if (v) out[key as keyof AppConfig] = v;
  }
  return out;
}

/** Persist provided keys (empty string clears). Env overrides still win at read time. */
export function setConfig(partial: Partial<AppConfig>): AppConfig {
  const next = { ...readFile(), ...partial };
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Public config surface — safe to expose to the client.
 * API keys are booleans; the Overpass endpoint is not a secret. */
export interface PublicConfig {
  googlePlacesApiKey: boolean;
  opencodeApiKey: boolean;
  opencodeGoApiKey: boolean;
  geoapifyApiKey: boolean;
  overpassEndpoint: string;
}

export function configStatus(): PublicConfig {
  const c = getConfig();
  return {
    googlePlacesApiKey: Boolean(c.googlePlacesApiKey),
    opencodeApiKey: Boolean(c.opencodeApiKey),
    opencodeGoApiKey: Boolean(c.opencodeGoApiKey),
    geoapifyApiKey: Boolean(c.geoapifyApiKey),
    overpassEndpoint: c.overpassEndpoint,
  };
}
