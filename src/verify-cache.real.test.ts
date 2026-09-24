/**
 * End-to-end verification of the discovery cache against a REAL Postgres
 * (local Supabase), not the in-memory fake. Proves the cache behaviours the
 * plan promised through the same entry point the app uses (`recommend`), so it
 * covers discover + scoring + the cache round trip.
 *
 * Run:
 *   eval "$(npx supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
 *   SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
 *     npx vitest run src/verify-cache.real.test.ts
 *
 * Skips itself when the env is absent, so `pnpm test` stays hermetic.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { recommend } from "@/lib/recommend";
import type { AppConfig } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(url && key);

const UNIQ = Date.now().toString(36);
const KW = `verify${UNIQ}`; // one word: recommend only translates single words
const LAT = 36.65;
const LNG = 138.19;
const EMPTY_LAT = 35.5;
const EMPTY_LNG = 139.5;
const DONE_PREFIX = `__done__:${EMPTY_LAT.toFixed(3)},${EMPTY_LNG.toFixed(3)}`;

const CONFIG: AppConfig = {
  googlePlacesApiKey: "AIza-verify",
  opencodeApiKey: "",
  opencodeGoApiKey: "",
  geoapifyApiKey: "",
  overpassEndpoint: "",
  guideModel: "",
};

let googleCalls = 0;
let overpassCalls = 0;

const placeRow = (id: string, name: string) => ({
  place_id: id,
  name,
  geometry: { location: { lat: LAT, lng: LNG } },
  rating: 4.8,
  user_ratings_total: 200,
});

async function cleanup() {
  const admin = getSupabaseAdmin();
  await admin.from("place_cache").delete().like("keyword_key", `%${UNIQ}%`);
  await admin.from("place_cache").delete().like("id", `${DONE_PREFIX}%`);
}

describe.skipIf(!live)("discovery cache against real Postgres", () => {
  beforeAll(async () => {
    // Supabase talks over fetch too. Requests to its own origin must reach the
    // real implementation, otherwise this stub swallows the very DB calls the
    // test exists to verify (and hides the cache's own error logging).
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      const u = String(input);
      if (u.startsWith(url!)) return realFetch(input as RequestInfo, init);
      if (u.includes("mymemory")) {
        // keep the single-word keyword as-is (no translation round trip)
        return Response.json({ responseStatus: 200, responseData: { translatedText: KW } });
      }
      if (u.includes("googleapis.com")) {
        googleCalls++;
        return Response.json({ status: "OK", results: [placeRow("v1", "Neko Cafe Uno")] });
      }
      if (u.includes("interpreter")) {
        overpassCalls++;
        return Response.json({ elements: [] });
      }
      if (u.includes("api.open-meteo.com")) {
        return Response.json({
          current: {
            time: "2026-01-01T00:00", temperature_2m: 20, apparent_temperature: 20,
            precipitation: 0, snowfall: 0, weather_code: 0, wind_speed_10m: 5, is_day: 1,
          },
          hourly: { time: [], temperature_2m: [], precipitation_probability: [], precipitation: [], snowfall: [], weather_code: [] },
          daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], sunrise: [], sunset: [] },
        });
      }
      return new Response("unexpected fetch: " + u, { status: 500 });
    });
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    vi.unstubAllGlobals();
  });

  it("persists keyword provenance and serves the repeat search from cache", async () => {
    const first = await recommend({
      lat: LAT, lng: LNG, types: ["food"], mode: "walking",
      keyword: KW, config: CONFIG,
    });
    expect(first.places.length).toBeGreaterThan(0);
    expect(first.sourceNote).toBe("google");
    const googleAfterFirst = googleCalls;

    // provenance survived the write — before this, from_keyword lived only in
    // memory, so a cached keyword pool could not be ranked by intent
    const { data: rows } = await getSupabaseAdmin()
      .from("place_cache")
      .select("id,from_keyword,keyword_key")
      .like("keyword_key", `%${UNIQ}%`);
    expect(rows?.length ?? 0).toBeGreaterThan(0);
    expect(rows!.every((r) => r.from_keyword === true)).toBe(true);

    const second = await recommend({
      lat: LAT, lng: LNG, types: ["food"], mode: "walking",
      keyword: KW, config: CONFIG,
    });
    expect(googleCalls).toBe(googleAfterFirst); // no new Google round trip
    expect(second.sourceNote).toBe("cache");
    expect(second.places.map((p) => p.id)).toEqual(first.places.map((p) => p.id));
    // the ranking input survived the round trip, or keyword order is lost
    expect(second.keywordResults).toBe(first.keywordResults);
    expect(second.keywordResults).toBeGreaterThan(0);
  });

  it("remembers a conclusive empty area and skips the sources on retry", async () => {
    const first = await recommend({
      lat: EMPTY_LAT, lng: EMPTY_LNG, types: ["park"], mode: "walking",
      config: CONFIG,
    });
    expect(first.places).toEqual([]);
    const overpassAfterFirst = overpassCalls;
    expect(overpassAfterFirst).toBeGreaterThan(0); // it really did ask

    const { data: marker } = await getSupabaseAdmin()
      .from("place_cache")
      .select("id")
      .like("id", `${DONE_PREFIX}%`);
    expect(marker?.length ?? 0).toBeGreaterThan(0);

    // this retry is the case that cost 20-84 s in production
    const second = await recommend({
      lat: EMPTY_LAT, lng: EMPTY_LNG, types: ["park"], mode: "walking",
      config: CONFIG,
    });
    expect(overpassCalls).toBe(overpassAfterFirst);
    expect(second.sourceNote).toBe("cache");
    expect(second.places).toEqual([]);
  });
});

describe.skipIf(live)("discovery cache against real Postgres (skipped)", () => {
  it("needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY", () => {
    expect(live).toBe(false);
  });
});
