import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { googleSearch } from "@/lib/places/google";
import { geoapifySearch } from "@/lib/places/geoapify";
import { overpassSearch } from "@/lib/places/overpass";
import { discover } from "@/lib/places";
import { resolveTypes } from "@/lib/places/taxonomy";
import { upsertPlace } from "@/lib/db";
import { mockFetch, jsonResponse, urlContains, isolatedStore } from "@/test-utils/helpers";

const KEY = "AIza-test";

const googleResult = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  place_id: id,
  name,
  geometry: { location: { lat: 36.65, lng: 138.19 } },
  rating: 4.3,
  user_ratings_total: 120,
  photos: [
    { photo_reference: "ref-a" },
    { photo_reference: "ref-b" },
    { photo_reference: "ref-c" },
  ],
  ...over,
});

describe("googleSearch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses results with rating, reviews and up to 5 photos", async () => {
    mockFetch([
      {
        match: urlContains("textsearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [googleResult("p1", "Templo A", { photos: [{ photo_reference: "r1" }, { photo_reference: "r2" }] })],
          }),
      },
      {
        match: urlContains("nearbysearch"),
        response: () => jsonResponse({ status: "OK", results: [googleResult("p1", "Templo A")] }),
      },
    ]);
    const places = await googleSearch(KEY, resolveTypes(["temple"])[0], 36.65, 138.19, 5000, "es");
    expect(places).toHaveLength(1); // deduped by place_id
    expect(places[0].userRatingsTotal).toBe(120);
    expect(places[0].photoRefs).toEqual(["r1", "r2"]);
    expect(places[0].tags).toEqual(["temple"]);
  });

  it("asks for strictbounds and opennow in real mode", async () => {
    let urls: string[] = [];
    mockFetch([
      {
        match: (u) => u.includes("textsearch") || u.includes("nearbysearch"),
        response: (u) => {
          urls.push(u);
          return jsonResponse({ status: "ZERO_RESULTS", results: [] });
        },
      },
    ]);
    await googleSearch(KEY, resolveTypes(["museum"])[0], 36.65, 138.19, 5000, "es");
    expect(urls.length).toBe(2); // text + nearby
    expect(urls.some((u) => u.includes("strictbounds=true"))).toBe(true);
    expect(urls.some((u) => u.includes("opennow=true"))).toBe(true);
  });

  it("omits opennow in simulation mode", async () => {
    let urls: string[] = [];
    mockFetch([
      {
        match: (u) => u.includes("textsearch") || u.includes("nearbysearch"),
        response: (u) => {
          urls.push(u);
          return jsonResponse({ status: "ZERO_RESULTS", results: [] });
        },
      },
    ]);
    await googleSearch(KEY, resolveTypes(["museum"])[0], 36.65, 138.19, 5000, "es", true);
    expect(urls.length).toBe(2);
    expect(urls.some((u) => u.includes("opennow=true"))).toBe(false);
  });

  it("filters out closed businesses", async () => {
    mockFetch([
      {
        match: urlContains("textsearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              googleResult("open", "Abierto", { business_status: "OPERATIONAL" }),
              googleResult("closed", "Cerrado", { business_status: "CLOSED_PERMANENTLY" }),
            ],
          }),
      },
      {
        match: urlContains("nearbysearch"),
        response: () => jsonResponse({ status: "OK", results: [] }),
      },
    ]);
    const places = await googleSearch(KEY, resolveTypes(["food"])[0], 36.65, 138.19, 5000, "es");
    expect(places.map((p) => p.id)).toEqual(["g_open"]);
  });
});

describe("geoapifySearch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses features and skips unmapped types", async () => {
    mockFetch([
      {
        match: urlContains("api.geoapify.com/v2/places"),
        response: () =>
          jsonResponse({
            features: [
              {
                properties: { name: "Café X", address_line1: "Calle 1" },
                geometry: { coordinates: [138.19, 36.65] },
              },
            ],
          }),
      },
    ]);
    const places = await geoapifySearch("geo-key", resolveTypes(["food"]), 36.65, 138.19, 5000, "es");
    expect(places).toHaveLength(1);
    expect(places[0].source).toBe("geoapify");
    // temple has no geoapify mapping → no request, empty result
    const temple = await geoapifySearch("geo-key", resolveTypes(["temple"]), 36.65, 138.19, 5000, "es");
    expect(temple).toHaveLength(0);
  });
});

describe("overpassSearch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("assigns types by tag match and falls back to a generic name", async () => {
    mockFetch([
      {
        match: urlContains("interpreter"),
        response: () =>
          jsonResponse({
            elements: [
              { type: "node", id: 1, lat: 36.65, lon: 138.19, tags: { leisure: "hot_spring", name: "Kame no Yu" } },
              { type: "node", id: 2, lat: 36.66, lon: 138.2, tags: { tourism: "viewpoint" } },
              { type: "way", id: 3, center: { lat: 36.67, lon: 138.21 }, tags: { leisure: "park" } },
            ],
          }),
      },
    ]);
    const places = await overpassSearch(resolveTypes(["onsen", "viewpoint", "park"]), 36.65, 138.19, 5000);
    expect(places.find((p) => p.id === "o_node_1")?.name).toBe("Kame no Yu");
    expect(places.find((p) => p.id === "o_node_1")?.tags).toEqual(["onsen"]);
    expect(places.find((p) => p.id === "o_node_2")?.tags).toEqual(["viewpoint"]);
    expect(places.find((p) => p.id === "o_way_3")?.tags).toEqual(["park"]);
    expect(places.find((p) => p.id === "o_node_2")?.name).toContain("Mirador"); // fallback name
  });

  it("sends a single combined query with every tag spec", async () => {
    const fn = mockFetch([
      {
        match: urlContains("interpreter"),
        response: () => jsonResponse({ elements: [] }),
      },
    ]);
    await overpassSearch(resolveTypes(["onsen", "temple"]), 36.65, 138.19, 5000);
    expect(fn).toHaveBeenCalledTimes(1); // one combined query, not one per type
    const called = fn.mock.calls[0];
    const sent = decodeURIComponent(String(called[1]?.body ?? ""));
    expect(sent).toContain('leisure="hot_spring"');
    expect(sent).toContain('name~"温泉"');
    expect(sent).toContain('historic="temple"');
  });
});

describe("discover — source chain", () => {
  beforeEach(() => {
    isolatedStore();
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    process.env.GEOAPIFY_API_KEY = "geo-key";
  });
  afterEach(() => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GEOAPIFY_API_KEY;
    vi.unstubAllGlobals();
  });

  it("uses google when it returns places", async () => {
    mockFetch([
      {
        match: urlContains("googleapis.com"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              { place_id: "x1", name: "Parque", geometry: { location: { lat: 36.65, lng: 138.19 } } },
            ],
          }),
      },
    ]);
    const { places, source } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    expect(source).toBe("google");
    expect(places).toHaveLength(1);
  });

  it("drops world-famous places that text search leaks beyond the radius", async () => {
    mockFetch([
      {
        match: urlContains("googleapis.com"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              // local (within 5km)
              { place_id: "local1", name: "Parque Local", geometry: { location: { lat: 36.65, lng: 138.19 } } },
              // San Diego (≈9,000 km away) — must never become a candidate
              { place_id: "far1", name: "San Diego View Point", geometry: { location: { lat: 32.71, lng: -117.16 } } },
            ],
          }),
      },
    ]);
    const { places } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    expect(places.map((p) => p.id)).toEqual(["g_local1"]);
  });

  it("falls back to geoapify when google fails", async () => {
    mockFetch([
      { match: urlContains("googleapis.com"), response: () => jsonResponse({}, 500) },
      {
        match: urlContains("api.geoapify.com"),
        response: () =>
          jsonResponse({
            features: [
              { properties: { name: "Geo Café" }, geometry: { coordinates: [138.19, 36.65] } },
            ],
          }),
      },
    ]);
    const { places, source } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["food"] });
    expect(source).toBe("geoapify");
    expect(places[0].name).toBe("Geo Café");
  });

  it("falls back to overpass when google and geoapify fail", async () => {
    mockFetch([
      { match: urlContains("googleapis.com"), response: () => jsonResponse({}, 500) },
      { match: urlContains("api.geoapify.com"), response: () => jsonResponse({}, 500) },
      {
        match: urlContains("interpreter"),
        response: () =>
          jsonResponse({
            elements: [{ type: "node", id: 9, lat: 36.65, lon: 138.19, tags: { leisure: "park" } }],
          }),
      },
    ]);
    const { places, source } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    expect(source).toBe("overpass");
    expect(places).toHaveLength(1);
  });

  it("serves the local cache when everything fails and it covers the types", async () => {
    upsertPlace({
      id: "c1", source: "google", name: "Cached Park", lat: 36.65, lng: 138.19,
      tags: ["park"], openNow: null,
    });
    mockFetch([{ match: () => true, response: () => jsonResponse({}, 500) }]);
    const { places, source } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    expect(source).toBe("cache");
    expect(places[0].name).toBe("Cached Park");
  });

  it("returns whatever cache matches when live sources fail and coverage is partial", async () => {
    upsertPlace({
      id: "c1", source: "google", name: "Cached Park", lat: 36.65, lng: 138.19,
      tags: ["park"], openNow: null,
    });
    mockFetch([{ match: () => true, response: () => jsonResponse({}, 500) }]);
    const { places, source } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park", "museum"] });
    expect(source).toBe("cache");
    expect(places.map((p) => p.tags)).toEqual([["park"]]);
  });
});
