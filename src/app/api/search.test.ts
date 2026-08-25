import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as suggestGET } from "@/app/api/search/suggest/route";
import type { SearchSuggestion } from "@/lib/types";
import { setAdminForTests } from "@/lib/cache";
import { resetRateLimits } from "@/lib/security";
import { makeSupabaseFake } from "@/test-utils/supabase-fake";
import { mockFetch, jsonResponse, urlContains, isolatedStore } from "@/test-utils/helpers";

function get(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/search/suggest", () => {
  let sb: ReturnType<typeof makeSupabaseFake>;

  beforeEach(() => {
    isolatedStore();
    resetRateLimits();
    sb = makeSupabaseFake();
    setAdminForTests(() => sb.fake as never);
    sb.places.set("g_cached", {
      id: "g_cached",
      source: "google",
      name: "Nagano Station View",
      lat: 36.648,
      lng: 138.19,
      tags: JSON.stringify(["viewpoint"]),
      rating: 4.5,
      user_ratings_total: 120,
      fetched_at: new Date().toISOString(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects missing or too-short queries", async () => {
    expect((await suggestGET(get("http://x/api/search/suggest"))).status).toBe(400);
    expect((await suggestGET(get("http://x/api/search/suggest?q=a"))).status).toBe(400);
    expect((await suggestGET(get("http://x/api/search/suggest?q=%20%20"))).status).toBe(400);
  });

  it("accepts a single CJK character", async () => {
    mockFetch([
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse({ features: [] }) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse([]) },
    ]);
    const res = await suggestGET(get(`http://x/api/search/suggest?q=${encodeURIComponent("寺")}`));
    expect(res.status).toBe(200);
  });

  it("merges local cache and remote sources into one ranked list", async () => {
    mockFetch([
      {
        match: urlContains("photon.komoot.io"),
        response: () =>
          jsonResponse({
            features: [
              {
                geometry: { coordinates: [138.195, 36.649] },
                properties: {
                  osm_id: 1,
                  name: "Nagano Station",
                  osm_key: "railway",
                  osm_value: "station",
                  type: "house",
                  city: "Nagano",
                  country: "Japan",
                },
              },
            ],
          }),
      },
      {
        match: urlContains("nominatim.openstreetmap.org"),
        response: () =>
          jsonResponse([
            { place_id: 9, name: "Nagano", display_name: "Nagano, Nagano, Japan", lat: "36.6485", lon: "138.1949", category: "place", type: "city" },
          ]),
      },
    ]);

    const res = await suggestGET(get("http://x/api/search/suggest?q=nagano&lat=36.6485&lng=138.1949"));
    expect(res.status).toBe(200);
    const { suggestions } = (await res.json()) as { suggestions: SearchSuggestion[] };
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    // local cache record has a rating and should outrank the remote twins on ties
    const cached = suggestions.find((s) => s.source === "cache");
    expect(cached?.rating).toBe(4.5);
    expect(cached?.distanceKm).toBeLessThan(0.6);
    // the city from nominatim resolves to kind "city"
    expect(suggestions.find((s) => s.name === "Nagano")?.kind).toBe("city");
  });

  it("still answers 200 when every remote source is down (cache-only)", async () => {
    mockFetch([
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse({}, 500) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse({}, 503) },
    ]);
    const res = await suggestGET(get("http://x/api/search/suggest?q=nagano"));
    expect(res.status).toBe(200);
    const { suggestions } = (await res.json()) as { suggestions: SearchSuggestion[] };
    expect(suggestions.map((s) => s.name)).toContain("Nagano Station View");
  });

  it("treats missing lat/lng as no bias, not (0,0)", async () => {
    mockFetch([
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse({ features: [] }) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse([]) },
    ]);
    const res = await suggestGET(get("http://x/api/search/suggest?q=nagano"));
    const { suggestions } = (await res.json()) as { suggestions: SearchSuggestion[] };
    const cached = suggestions.find((s) => s.source === "cache");
    expect(cached?.distanceKm).toBeUndefined();
  });

  it("rate-limits per IP after the budget", async () => {
    mockFetch([
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse({ features: [] }) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse([]) },
    ]);
    let last: Response | null = null;
    for (let i = 0; i < 61; i++) {
      last = await suggestGET(get("http://x/api/search/suggest?q=nagano"));
    }
    expect(last?.status).toBe(429);
  });
});
