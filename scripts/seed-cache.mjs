import { readFileSync } from "node:fs";

/** Parse a .env.local-style file (KEY=VALUE, ignoring comments). */
export function parseDotEnv(file = ".env.local") {
  const out = {};
  try {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env.local → rely on process.env
  }
  return { ...out, ...process.env };
}

/**
 * Seed the shared place cache (Supabase `place_cache`) so test searches are
 * deterministic: placeholder keys cannot reach Google/Geoapify, and public
 * Overpass mirrors are unreliable (rate-limited). The discovery chain itself
 * is covered by unit tests — these scripts exercise the app flow against a
 * known-cached area.
 */
export async function seedPlaceCache(lat, lng, prefix = "e2e-seed") {
  const env = parseDotEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("   ⚠ no SUPABASE_URL/service key — skipping cache seed");
    return;
  }
  const now = new Date().toISOString();
  const names = ["Parque Central", "Museo de Arte", "Templo Antiguo", "Ramen House", "Café Local", "Mirador del Río"];
  const tagPool = ["park", "museum", "temple", "food", "food", "viewpoint"];
  const rows = names.map((name, i) => ({
    id: `${prefix}-${i}`,
    source: "google",
    name,
    lat: lat + (i - 2) * 0.002,
    lng: lng + (i % 3) * 0.002,
    tags: JSON.stringify([tagPool[i]]),
    rating: 4.3,
    fetched_at: now,
  }));
  await fetch(`${url}/rest/v1/place_cache`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
}
