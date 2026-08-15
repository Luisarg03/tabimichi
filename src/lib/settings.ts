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
}

const CONFIG_PATH = path.join(process.cwd(), "data", "config.json");

export const ENV_KEYS: Record<keyof AppConfig, string> = {
  googlePlacesApiKey: "GOOGLE_PLACES_API_KEY",
  opencodeApiKey: "OPENCODE_API_KEY",
  opencodeGoApiKey: "OPENCODE_GO_API_KEY",
};

const DEFAULT_CONFIG: AppConfig = {
  googlePlacesApiKey: "",
  opencodeApiKey: "",
  opencodeGoApiKey: "",
};

function readFile(): AppConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
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
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Connection status booleans — safe to expose to the client. */
export function configStatus(): Record<keyof AppConfig, boolean> {
  const c = getConfig();
  return {
    googlePlacesApiKey: Boolean(c.googlePlacesApiKey),
    opencodeApiKey: Boolean(c.opencodeApiKey),
    opencodeGoApiKey: Boolean(c.opencodeGoApiKey),
  };
}
