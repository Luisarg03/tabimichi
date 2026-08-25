import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  normalizeQuery,
  matchTier,
  osmTypeId,
  rankSuggestions,
  searchPlaces,
  SUGGEST_LIMIT_MAX,
} from "./search";
import { searchCachedPlaces, setAdminForTests } from "../cache";
import { makeSupabaseFake } from "@/test-utils/supabase-fake";
import { mockFetch, jsonResponse, urlContains } from "@/test-utils/helpers";
import type { SearchSuggestion } from "../types";

const sug = (over: Partial<SearchSuggestion>): SearchSuggestion => ({
  id: "x",
  kind: "place",
  name: "X",
  lat: 0,
  lng: 0,
  source: "cache",
  ...over,
});

describe("query normalization & match tiers", () => {
  it("normalizes NFKC, case and diacritics", () => {
    expect(normalizeQuery("  Ｃａｆé  奈良 ")).toBe("cafe 奈良");
    expect(normalizeQuery("MÜLLER")).toBe("muller");
  });

  it("ranks exact > prefix > word-prefix > contains > miss", () => {
    expect(matchTier("Nagano", "nagano")).toBe(0);
    expect(matchTier("Nagano Station", "nagano")).toBe(1);
    expect(matchTier("JR Nagano", "nagano")).toBe(2);
    expect(matchTier("Higashinagano", "nagano")).toBe(3);
    expect(matchTier("Matsumoto", "nagano")).toBe(4);
  });

  it("matches CJK substrings (no word boundaries in Japanese)", () => {
    expect(matchTier("善光寺", "善光")).toBe(1);
    expect(matchTier("大善光寺", "善光")).toBe(3);
  });
});

describe("OSM type mapping reuses the taxonomy", () => {
  it("maps discovery spec tags", () => {
    expect(osmTypeId("amenity", "restaurant")).toBe("food");
    expect(osmTypeId("tourism", "museum")).toBe("museum");
    expect(osmTypeId("historic", "temple")).toBe("temple");
  });

  it("maps curated aliases", () => {
    expect(osmTypeId("amenity", "cafe")).toBe("food");
    expect(osmTypeId("amenity", "bar")).toBe("nightlife");
  });

  it("leaves unknown categories unmapped", () => {
    expect(osmTypeId("office", "company")).toBeUndefined();
    expect(osmTypeId(undefined, undefined)).toBeUndefined();
  });
});

describe("suggestion ranking", () => {
  it("exact match beats nearby prefix beats far prefix", () => {
    const items = [
      sug({ id: "far-prefix", name: "Nagano City Hall", lat: 36.65, lng: 138.19, distanceKm: 2 }),
      sug({ id: "exact", name: "Nagano", lat: 10, lng: 10, distanceKm: 9000 }),
      sug({ id: "near-prefix", name: "Nagano Station", lat: 36.65, lng: 138.19, distanceKm: 0.4 }),
    ];
    const out = rankSuggestions(items, "nagano", 3);
    expect(out.map((s) => s.id)).toEqual(["exact", "near-prefix", "far-prefix"]);
  });

  it("breaks ties by rating then distance", () => {
    const items = [
      sug({ id: "a", name: "Temple Street", rating: 4.6, distanceKm: 3 }),
      sug({ id: "b", name: "Temple Gate", rating: 4.1, distanceKm: 0.3 }),
      sug({ id: "c", name: "Temple Inn", rating: undefined, distanceKm: 1 }),
    ];
    const out = rankSuggestions(items, "temple", 3);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("respects the limit", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      sug({ id: `p${i}`, name: `Place ${i}`, distanceKm: i })
    );
    expect(rankSuggestions(items, "place", SUGGEST_LIMIT_MAX)).toHaveLength(10);
  });

  it("cross-script remote matches rank as prefix, not miss (romaji query ↔ kanji name)", () => {
    const items = [
      sug({ id: "cache-food", name: "Nagano Station Ramen", source: "cache" }),
      sug({ id: "photon-city", name: "長野市", source: "photon", remoteRank: 0, lat: 36.65, lng: 138.19, distanceKm: 0.2 }),
    ];
    const out = rankSuggestions(items, "nagano", 5);
    expect(out[0].id).toBe("photon-city"); // tier 1 via cross-script > tier 2 word-prefix
  });

  it("exact-match ties break by provider relevance", () => {
    const items = [
      sug({ id: "photon-low", name: "Zenkoji", source: "photon", remoteRank: 7 }),
      sug({ id: "nominatim-top", name: "Zenkoji", source: "nominatim", remoteRank: 0 }),
    ];
    const out = rankSuggestions(items, "zenkoji", 5);
    expect(out[0].id).toBe("nominatim-top");
  });
});

describe("searchPlaces (merged sources)", () => {
  let sb: ReturnType<typeof makeSupabaseFake>;

  const photonBody = {
    features: [
      {
        geometry: { coordinates: [139.7798, 35.714] },
        properties: {
          osm_id: 11,
          name: "Edo-Tokyo Museum",
          osm_key: "tourism",
          osm_value: "museum",
          type: "house",
          street: "Yokoami",
          city: "Tokyo",
          country: "Japan",
        },
      },
      {
        geometry: { coordinates: [138.195, 36.649] },
        properties: { osm_id: 12, name: "Nagano Station", osm_key: "railway", osm_value: "station", type: "house", city: "Nagano", country: "Japan" },
      },
    ],
  };
  const nominatimBody = [
    {
      place_id: 201,
      name: "Nagano",
      display_name: "Nagano, Nagano Prefecture, Japan",
      lat: "36.6485",
      lon: "138.1949",
      category: "boundary",
      type: "administrative",
    },
  ];

  beforeEach(() => {
    sb = makeSupabaseFake();
    setAdminForTests(() => sb.fake as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function seedRow(id: string, over: Record<string, unknown> = {}) {
    sb.places.set(id, {
      id,
      source: "google",
      name: "Cached Place",
      lat: 35.714,
      lng: 139.7799,
      tags: JSON.stringify(["museum"]),
      rating: 4.8,
      user_ratings_total: 300,
      address: "Yokoami, Tokyo",
      fetched_at: new Date().toISOString(),
      ...over,
    });
  }

  it("merges cache + photon + nominatim, dedupes by name within 150 m, keeps the richer record", async () => {
    // cache row ≈ 8 m from photon's "Edo-Tokyo Museum" → same POI, cache wins (rating)
    seedRow("g_edo", { name: "Edo-Tokyo Museum" });
    mockFetch([
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse(photonBody) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse(nominatimBody) },
    ]);

    const { suggestions, sources } = await searchPlaces({ q: "edo", lat: 35.71, lng: 139.78 });
    expect(sources).toEqual(["cache", "photon", "nominatim"]);

    const edo = suggestions.find((s) => s.name === "Edo-Tokyo Museum");
    expect(edo?.source).toBe("cache");
    expect(edo?.rating).toBe(4.8);
    expect(edo?.typeId).toBe("museum");
    // photon's Nagano Station + nominatim's Nagano city still present
    expect(suggestions.some((s) => s.name === "Nagano Station")).toBe(true);
    expect(suggestions.some((s) => s.name === "Nagano" && s.kind === "city")).toBe(true);
  });

  it("degrades when Photon is down — Nominatim + cache still answer", async () => {
    seedRow("g_x", { name: "Nagano Station Hotel", lat: 36.649, lng: 138.195, tags: JSON.stringify(["food"]) });
    mockFetch([
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse({ error: "boom" }, 500) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse(nominatimBody) },
    ]);

    const { suggestions, sources } = await searchPlaces({ q: "nagano" });
    expect(sources).toContain("nominatim");
    expect(sources).toContain("cache");
    expect(sources).not.toContain("photon");
    expect(suggestions.some((s) => s.kind === "city")).toBe(true);
  });

  it("dedupe keeps the provider's better-ranked copy (nominatim rank 0 beats photon rank 1)", async () => {
    mockFetch([
      {
        match: urlContains("photon.komoot.io"),
        response: () =>
          jsonResponse({
            features: [
              // decoy first so Zenkoji's photon rank is 1, nominatim's is 0
              {
                geometry: { coordinates: [140.0, 40.0] },
                properties: { osm_id: 999, name: "Somewhere Else", osm_key: "place", osm_value: "city", type: "city" },
              },
              {
                geometry: { coordinates: [138.1876, 36.6614] },
                properties: { osm_id: 77, name: "Zenkoji", osm_key: "amenity", osm_value: "place_of_worship", type: "house" },
              },
            ],
          }),
      },
      {
        match: urlContains("nominatim.openstreetmap.org"),
        response: () =>
          jsonResponse([
            { place_id: 1, name: "Zenkoji", display_name: "Zenkoji, Nagano", lat: "36.6615", lon: "138.1877", category: "amenity", type: "place_of_worship" },
          ]),
      },
    ]);
    const { suggestions } = await searchPlaces({ q: "zenkoji" });
    const zen = suggestions.filter((s) => s.name === "Zenkoji");
    expect(zen).toHaveLength(1);
    expect(zen[0].source).toBe("nominatim");
  });

  it("omits photon's lang param for es (photon 400s on unsupported langs)", async () => {
    const fn = mockFetch([
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse({ features: [] }) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse([]) },
    ]);
    await searchPlaces({ q: "edo", lang: "es" });
    const photonUrl = fn.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("photon.komoot.io"));
    expect(photonUrl).toBeDefined();
    expect(photonUrl).not.toContain("lang=es");
  });

  it("returns empty (not throw) when every source fails", async () => {
    mockFetch([
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse({}, 500) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse({}, 503) },
    ]);
    const { suggestions } = await searchPlaces({ q: "nagano" });
    expect(suggestions).toEqual([]);
  });

  it("adds distanceKm when a bias point is given", async () => {
    seedRow("g_n", { name: "Nagano Station", lat: 36.648, lng: 138.19 });
    mockFetch([
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse({ features: [] }) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse([]) },
    ]);
    const { suggestions } = await searchPlaces({ q: "nagano", lat: 36.6485, lng: 138.1949 });
    const cached = suggestions.find((s) => s.source === "cache");
    expect(cached?.distanceKm).toBeLessThan(0.6);
  });
});

describe("searchCachedPlaces", () => {
  let sb: ReturnType<typeof makeSupabaseFake>;

  beforeEach(() => {
    sb = makeSupabaseFake();
    setAdminForTests(() => sb.fake as never);
  });

  it("searches name and address, escaping ILIKE wildcards", async () => {
    sb.places.set("a", {
      id: "a",
      source: "overpass",
      name: "100% Sushi",
      lat: 35,
      lng: 139,
      tags: JSON.stringify(["food"]),
      fetched_at: new Date().toISOString(),
    });
    sb.places.set("b", {
      id: "b",
      source: "overpass",
      name: "Plain Ramen",
      lat: 35,
      lng: 139,
      address: "Sushi Street",
      tags: JSON.stringify(["food"]),
      fetched_at: new Date().toISOString(),
    });
    sb.places.set("c", {
      id: "c",
      source: "overpass",
      name: "Udon",
      lat: 35,
      lng: 139,
      tags: JSON.stringify(["food"]),
      fetched_at: new Date().toISOString(),
    });

    const byName = await searchCachedPlaces("sushi", 10);
    expect(byName.map((p) => p.id).sort()).toEqual(["a", "b"]);

    // "%" in the input matches literally, not as a wildcard: "100% Sushi"
    // matches "%sushi" but a plain "1" query must NOT match every row.
    const wildcard = await searchCachedPlaces("1", 10);
    expect(wildcard.map((p) => p.id)).toEqual(["a"]);
  });

  it("degrades to [] when the client errors", async () => {
    setAdminForTests(() => {
      throw new Error("supabase down");
    });
    expect(await searchCachedPlaces("anything")).toEqual([]);
  });
});

describe("searchPlaces — Google Autocomplete (BYOK)", () => {
  let sb: ReturnType<typeof makeSupabaseFake>;

  beforeEach(() => {
    sb = makeSupabaseFake();
    setAdminForTests(() => sb.fake as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  function seedRow(id: string, over: Record<string, unknown> = {}) {
    sb.places.set(id, {
      id,
      source: "google",
      name: "Edo-Tokyo Museum",
      lat: 35.714,
      lng: 139.7799,
      tags: JSON.stringify(["museum"]),
      rating: 4.8,
      fetched_at: new Date().toISOString(),
      ...over,
    });
  }

  it("prepends Google's ranked predictions and dedupes twins by name", async () => {
    seedRow("g_edo");
    mockFetch([
      {
        match: urlContains("maps.googleapis.com/maps/api/place/autocomplete"),
        response: () =>
          jsonResponse({
            status: "OK",
            predictions: [
              { place_id: "gm1", description: "Edo-Tokyo Museum, 1 Chome Yokoami, Sumida City, Tokyo, Japan", types: ["museum"] },
              { place_id: "gm2", description: "Edo-Tokyo Open Air Museum, Tokyo, Japan", types: ["museum"] },
            ],
          }),
      },
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse({ features: [] }) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse([]) },
    ]);

    const { suggestions, sources } = await searchPlaces({ q: "edo", googleKey: "test-key" });
    expect(sources[0]).toBe("google");
    expect(suggestions[0].source).toBe("google");
    expect(suggestions[0].placeId).toBe("gm1");
    expect(suggestions[0].typeId).toBe("museum");
    expect(suggestions[0].lat).toBeUndefined();
    expect(suggestions[0].name).toBe("Edo-Tokyo Museum");
    // the cached twin (same name) is dropped so the place never appears twice
    expect(suggestions.filter((s) => s.name === "Edo-Tokyo Museum")).toHaveLength(1);
  });

  it("skips Google when there is no key (free sources only)", async () => {
    const fn = mockFetch([
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse({ features: [] }) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse([]) },
    ]);
    const { suggestions, sources } = await searchPlaces({ q: "edo" });
    expect(sources).not.toContain("google");
    expect(suggestions).toHaveLength(0);
    const urls = fn.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("autocomplete"))).toBe(false);
  });

  it("degrades gracefully when Google's autocomplete fails", async () => {
    seedRow("g_edo");
    mockFetch([
      { match: urlContains("maps.googleapis.com/maps/api/place/autocomplete"), response: () => jsonResponse({}, 500) },
      { match: urlContains("photon.komoot.io"), response: () => jsonResponse({ features: [] }) },
      { match: urlContains("nominatim.openstreetmap.org"), response: () => jsonResponse([]) },
    ]);
    const { suggestions, sources } = await searchPlaces({ q: "edo", googleKey: "test-key" });
    expect(sources).not.toContain("google");
    expect(suggestions.some((s) => s.source === "cache")).toBe(true);
  });
});
