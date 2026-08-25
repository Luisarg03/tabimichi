import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { emptyReasonFor, diversify, recommend, RESULT_LIMIT } from "@/lib/recommend";
import { clearWeatherCache } from "@/lib/weather";
import { readLogTail } from "@/lib/logger";
import { mockFetch, jsonResponse, urlContains, isolatedStore } from "@/test-utils/helpers";

const KEY = "AIza-test";

const weatherFixture = () =>
  jsonResponse({
    current: {
      time: "2026-08-16T00:00",
      temperature_2m: 25,
      apparent_temperature: 27,
      precipitation: 0,
      snowfall: 0,
      weather_code: 1,
      wind_speed_10m: 5,
      is_day: 0,
    },
    hourly: {
      time: ["2026-08-16T03:00", "2026-08-16T09:00"],
      temperature_2m: [23, 24],
      precipitation_probability: [0, 10],
      precipitation: [0, 0],
      snowfall: [0, 0],
      weather_code: [1, 0],
    },
    daily: {
      time: ["2026-08-16"],
      weather_code: [1],
      temperature_2m_max: [28],
      temperature_2m_min: [20],
      precipitation_probability_max: [20],
      sunrise: ["2026-08-16T05:10"],
      sunset: ["2026-08-16T18:40"],
    },
  });

const result = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  place_id: id,
  name,
  geometry: { location: { lat: 36.65, lng: 138.19 } },
  rating: 4.3,
  user_ratings_total: 100,
  photos: [{ photo_reference: `ref-${id}` }],
  ...over,
});

const googleSearch = (results: Record<string, unknown>[]) =>
  jsonResponse({ status: "OK", results });

describe("emptyReasonFor", () => {
  const c = (open: boolean | null) => ({ id: "x", source: "google" as const, name: "x", lat: 1, lng: 1, tags: ["park"], openNow: open });

  it("no_results when there are no candidates", () => {
    expect(emptyReasonFor([], 0)).toBe("no_results");
  });

  it("undefined when results exist", () => {
    expect(emptyReasonFor([c(true)], 3)).toBeUndefined();
  });

  it("all_closed when every candidate is closed", () => {
    expect(emptyReasonFor([c(false), c(false)], 0)).toBe("all_closed");
  });

  it("all_closed when closed candidates dominate an empty result", () => {
    expect(emptyReasonFor([c(false), c(null)], 0)).toBe("all_closed");
  });

  it("too_far when nothing is closed but nothing scored", () => {
    expect(emptyReasonFor([c(null), c(true)], 0)).toBe("too_far");
  });
});

describe("recommend — pipeline outcomes", () => {
  beforeEach(() => {
    isolatedStore();
    clearWeatherCache();
    process.env.GOOGLE_PLACES_API_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    vi.unstubAllGlobals();
  });

  it("returns places in real mode (closed ones stay, ranked below open)", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("textsearch"),
        response: () =>
          googleSearch([
            result("p1", "Abierto", { opening_hours: { open_now: true } }),
            result("p2", "Cerrado", { opening_hours: { open_now: false } }),
          ]),
      },
      { match: urlContains("nearbysearch"), response: () => jsonResponse({ status: "OK", results: [] }) },
      { match: urlContains("interpreter"), response: () => jsonResponse({ elements: [] }) },
    ]);
    const r = await recommend({ lat: 36.65, lng: 138.19, budget: "afternoon", types: ["park"], mode: "walking" });
    expect(r.places.map((p) => p.id)).toEqual(["g_p1", "g_p2"]);
    expect(r.places[0].openNow).toBe(true);
    expect(r.places[1].openNow).toBe(false);
    expect(r.emptyReason).toBeUndefined();
    expect(r.traceId).toMatch(/^tr_/);

    // the persisted log carries the full trace: filters breakdown + reasons
    const entry = readLogTail(1)[0] as Record<string, unknown>;
    expect(entry.type).toBe("recommend");
    expect(entry.traceId).toBe(r.traceId);
    expect((entry.filters as { closed: number }).closed).toBe(1); // p2 closed
    expect(entry.candidates).toBe(2);
    expect(entry.scored).toBe(2);
    const top = entry.top as Array<{ name: string; reasons: string[] }>;
    expect(top[0].reasons).toContain("distanceGood");
    expect(top[1].reasons).toContain("closedNow");
  });

  it("threads the interest keyword into discovery, scoring and the log", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("textsearch"),
        response: (u) =>
          googleSearch(
            u.includes("query=pokemon+near")
              ? [result("p1", "Pokémon Center", { opening_hours: { open_now: true } })]
              : [result("p2", "Otro", { opening_hours: { open_now: true } })]
          ),
      },
      { match: urlContains("nearbysearch"), response: () => jsonResponse({ status: "OK", results: [] }) },
    ]);
    const r = await recommend({
      lat: 36.65, lng: 138.19, budget: "afternoon", types: ["museum"], mode: "walking",
      keyword: "pokemon",
    });
    expect(r.places[0].id).toBe("g_p1"); // keyword query result ranked
    const entry = readLogTail(1)[0] as Record<string, unknown>;
    expect(entry.keyword).toBe("pokemon");
    const top = entry.top as Array<{ name: string; reasons: string[] }>;
    expect(top[0].reasons).toContain("keywordMatch");
  });

  it("translates Spanish keywords via MyMemory and matches translated names", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("api.mymemory.translated.net"),
        response: () =>
          jsonResponse({ responseData: { translatedText: "cat" }, responseStatus: 200 }),
      },
      {
        match: urlContains("textsearch"),
        response: (u) =>
          googleSearch(
            u.includes("query=cat+cafe+near")
              ? [result("c1", "Cat Cafe MoCHA", { opening_hours: { open_now: true } })]
              : [result("c2", "Otro", { opening_hours: { open_now: true } })]
          ),
      },
      { match: urlContains("nearbysearch"), response: () => jsonResponse({ status: "OK", results: [] }) },
    ]);
    const r = await recommend({
      lat: 36.65, lng: 138.19, budget: "afternoon", types: ["museum"], mode: "walking",
      keyword: "gatos",
    });
    expect(r.places[0].id).toBe("g_c1"); // 'cat' query → cat café
    const top = r.places[0];
    expect(top.reasons.some((x) => x.key === "keywordMatch")).toBe(true); // via translated term
  });

  it("keyword matches rank first even when a generic place scores higher", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("textsearch"),
        response: () =>
          googleSearch([
            // low-rated match: base 50 + dist + rating(−4) + vol + open + kw(+20)
            result("kw1", "Pokemon Center", {
              rating: 3, user_ratings_total: 5, opening_hours: { open_now: true },
            }),
          ]),
      },
      {
        match: urlContains("nearbysearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              // generic star: high rating + volume → way higher raw score
              result("gen1", "Big Museum", {
                rating: 4.6, user_ratings_total: 5000, opening_hours: { open_now: true },
              }),
            ],
          }),
      },
    ]);
    const r = await recommend({
      lat: 36.65, lng: 138.19, budget: "afternoon", types: ["museum"], mode: "walking",
      keyword: "pokemon",
    });
    expect(r.places[0].id).toBe("g_kw1"); // intent wins over rating/volume
    expect(r.keywordMiss).toBe(false);
    expect(r.keywordResults).toBeGreaterThan(0);
  });

  it("flags keywordMiss when the keyword query finds nothing", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("textsearch"),
        response: () => jsonResponse({ status: "ZERO_RESULTS", results: [] }),
      },
      {
        match: urlContains("nearbysearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              result("gen1", "Generic Place", { opening_hours: { open_now: true } }),
            ],
          }),
      },
    ]);
    const r = await recommend({
      lat: 36.65, lng: 138.19, budget: "afternoon", types: ["museum"], mode: "walking",
      keyword: "snoopy",
    });
    expect(r.keywordMiss).toBe(true);
    expect(r.keywordResults).toBe(0);
    expect(r.places.length).toBeGreaterThan(0); // generic pool still shown, honestly labeled
  });

  it("keyword-origin results rank first even without a name match", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("textsearch"),
        response: () =>
          googleSearch([
            // from the keyword query, but 'Feline Friends' matches no token
            result("kw1", "Feline Friends", { opening_hours: { open_now: true } }),
          ]),
      },
      {
        match: urlContains("nearbysearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              result("gen1", "Big Soba Restaurant", {
                rating: 4.6, user_ratings_total: 5000, opening_hours: { open_now: true },
              }),
            ],
          }),
      },
    ]);
    const r = await recommend({
      lat: 36.65, lng: 138.19, budget: "afternoon", types: ["museum"], mode: "walking",
      keyword: "cafe, neko",
    });
    expect(r.places[0].id).toBe("g_kw1"); // keyword-query result first, no name match needed
  });

  it("flags keywordMiss when keyword results exist but are out of reach", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("textsearch"),
        response: () =>
          googleSearch([
            // Google found a real Snoopy place — but ~30 km away
            result("far1", "SNOOPY Chaya", {
              geometry: { location: { lat: 36.9, lng: 138.3 } },
              opening_hours: { open_now: true },
            }),
          ]),
      },
      {
        match: urlContains("nearbysearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              result("local1", "Generic Place", { opening_hours: { open_now: true } }),
            ],
          }),
      },
    ]);
    const r = await recommend({
      lat: 36.65, lng: 138.19, budget: "afternoon", types: ["museum"], mode: "walking",
      keyword: "snoopy",
    });
    expect(r.keywordMiss).toBe(true); // nothing Snoopy-ish within reach
    expect(r.keywordResults).toBe(0);
    expect(r.places.map((p) => p.id)).toContain("g_local1");
  });

  it("drops low-relevance keyword results (rank ≥ 10) so junk can't mask a miss", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("textsearch"),
        response: () =>
          googleSearch([
            // Google's top-10: real Snoopy places, but all out of reach
            result("far1", "SNOOPY Chaya", { geometry: { location: { lat: 36.9, lng: 138.3 } }, opening_hours: { open_now: true } }),
            result("far2", "Snoopy Museum", { geometry: { location: { lat: 36.95, lng: 138.4 } }, opening_hours: { open_now: true } }),
            result("far3", "Snoopy Town", { geometry: { location: { lat: 36.98, lng: 138.5 } }, opening_hours: { open_now: true } }),
            result("far4", "Snoopy Café", { geometry: { location: { lat: 37.0, lng: 138.6 } }, opening_hours: { open_now: true } }),
            result("far5", "Snoopy Park", { geometry: { location: { lat: 37.1, lng: 138.7 } }, opening_hours: { open_now: true } }),
            result("far6", "Snoopy Shop", { geometry: { location: { lat: 37.2, lng: 138.8 } }, opening_hours: { open_now: true } }),
            result("far7", "Snoopy Plaza", { geometry: { location: { lat: 37.3, lng: 138.9 } }, opening_hours: { open_now: true } }),
            result("far8", "Snoopy Tower", { geometry: { location: { lat: 37.4, lng: 139.0 } }, opening_hours: { open_now: true } }),
            result("far9", "Snoopy Garden", { geometry: { location: { lat: 37.5, lng: 139.1 } }, opening_hours: { open_now: true } }),
            result("far10", "Snoopy Land", { geometry: { location: { lat: 37.6, lng: 139.2 } }, opening_hours: { open_now: true } }),
            // rank 11+: loose match near the user — must be dropped as noise
            result("junk1", "THANK YOU MART", { opening_hours: { open_now: true } }),
          ]),
      },
      {
        match: urlContains("nearbysearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [result("local1", "Zenko-ji Temple", { opening_hours: { open_now: true } })],
          }),
      },
    ]);
    const r = await recommend({
      lat: 36.65, lng: 138.19, budget: "afternoon", types: ["museum"], mode: "walking",
      keyword: "snoopy",
    });
    expect(r.keywordMiss).toBe(true);
    expect(r.keywordResults).toBe(0);
    expect(r.places.map((p) => p.id)).not.toContain("g_junk1"); // noise dropped
  });

  it("reports all_closed when simulation closes every candidate", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("textsearch"),
        response: () =>
          googleSearch([
            result("p1", "Café", { opening_hours: { open_now: true } }),
          ]),
      },
      { match: urlContains("nearbysearch"), response: () => jsonResponse({ status: "OK", results: [] }) },
      {
        match: urlContains("details/json"),
        response: () =>
          jsonResponse({
            status: "OK",
            result: {
              photos: [],
              opening_hours: { periods: [{ open: { day: 0, time: "0900" }, close: { day: 0, time: "1800" } }] },
            },
          }),
      },
      { match: urlContains("interpreter"), response: () => jsonResponse({ elements: [] }) },
    ]);
    // Sunday 21:00 JST → café closed
    const r = await recommend({
      lat: 36.65, lng: 138.19, budget: "afternoon", types: ["food"], mode: "walking",
      now: "2026-08-16T21:00:00.000Z",
    });
    expect(r.places).toHaveLength(0);
    expect(r.emptyReason).toBe("all_closed");
  });

  it("reports no_results when the sources return nothing", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      { match: urlContains("googleapis.com"), response: () => jsonResponse({}, 500) },
      { match: urlContains("api.geoapify.com"), response: () => jsonResponse({}, 500) },
      { match: urlContains("interpreter"), response: () => jsonResponse({ elements: [] }) },
    ]);
    const r = await recommend({ lat: 36.65, lng: 138.19, budget: "afternoon", types: ["park"], mode: "walking" });
    expect(r.places).toHaveLength(0);
    expect(r.emptyReason).toBe("no_results");
  });

  it("returns more than the old cap of 10 when the pool has more (RESULT_LIMIT=30)", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      result(`p${i}`, `Museo ${i}`, { opening_hours: { open_now: true } })
    );
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      { match: urlContains("textsearch"), response: () => googleSearch(many) },
      { match: urlContains("nearbysearch"), response: () => jsonResponse({ status: "OK", results: [] }) },
      { match: urlContains("interpreter"), response: () => jsonResponse({ elements: [] }) },
    ]);
    const r = await recommend({ lat: 36.65, lng: 138.19, budget: "afternoon", types: ["museum"], mode: "walking" });
    expect(r.places).toHaveLength(12); // 12 > 10 → the UI cap was raised
  });

  it("exposes the merged sources in the result", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("googleapis.com"),
        response: () =>
          googleSearch([result("p1", "Museo A", { opening_hours: { open_now: true } })]),
      },
      { match: urlContains("api.geoapify.com"), response: () => jsonResponse({}, 500) },
      {
        match: urlContains("interpreter"),
        response: () =>
          // 111 m away from the google place — outside the 40 m proximity
          // window, so the OSM museum survives the merge
          jsonResponse({ elements: [{ type: "node", id: 9, lat: 36.651, lon: 138.19, tags: { tourism: "museum", name: "Nagano Museum" } }] }),
      },
    ]);
    const r = await recommend({ lat: 36.65, lng: 138.19, budget: "afternoon", types: ["museum"], mode: "walking" });
    expect(r.sources).toEqual(["google", "overpass"]);
  });
});

describe("diversify", () => {
  it("spreads the top picks across tags, keeping global best first", () => {
    const items = [
      { id: "a", score: 99, tags: ["viewpoint"] },
      { id: "b", score: 98, tags: ["viewpoint"] },
      { id: "c", score: 97, tags: ["viewpoint"] },
      { id: "d", score: 96, tags: ["park"] },
      { id: "e", score: 95, tags: ["museum"] },
      { id: "f", score: 94, tags: ["food"] },
      { id: "g", score: 93, tags: ["temple"] },
    ];
    const out = diversify(items, 5);
    expect(out[0].id).toBe("a"); // global best first
    expect(out.map((o) => o.id)).toEqual(["a", "d", "e", "f", "g"]);
  });

  it("keeps single-type ordering untouched", () => {
    const items = [
      { id: "a", score: 99, tags: ["food"] },
      { id: "b", score: 98, tags: ["food"] },
      { id: "c", score: 97, tags: ["food"] },
    ];
    expect(diversify(items, 10).map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("fills remaining slots with next-best of each type", () => {
    const items = [
      { id: "a", score: 99, tags: ["viewpoint"] },
      { id: "b", score: 98, tags: ["viewpoint"] },
      { id: "c", score: 97, tags: ["viewpoint"] },
      { id: "d", score: 96, tags: ["park"] },
    ];
    const out = diversify(items, 4);
    expect(out.map((o) => o.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("fills RESULT_LIMIT slots across types (the UI shows 30 options, not 10)", () => {
    const tags = ["viewpoint", "temple", "park", "food", "museum"];
    const items = Array.from({ length: 60 }, (_, i) => ({
      id: `x${i}`,
      score: 100 - i,
      tags: [tags[i % tags.length]],
    }));
    const out = diversify(items, RESULT_LIMIT);
    expect(out.length).toBe(RESULT_LIMIT);
    expect(new Set(out.map((o) => o.tags[0])).size).toBe(tags.length); // variety kept
  });

  it("defers same-type candidates hugging an already-picked one (spatial spread)", () => {
    const mk = (id: string, tags: string[], lat: number, lng: number) => ({ id, tags, lat, lng });
    const items = [
      mk("t1", ["temple"], 36.65, 138.19),
      mk("t2", ["temple"], 36.6505, 138.1905), // ~90 m from t1 → deferred
      mk("t3", ["temple"], 36.66, 138.2), // ~1.5 km away → picked next
      mk("p1", ["park"], 36.7, 138.3),
    ];
    const out = diversify(items, 4);
    expect(out.map((o) => o.id)).toEqual(["t1", "p1", "t3", "t2"]);
  });
});

describe("recommend — pinned place (Google-Maps parity)", () => {
  beforeEach(() => {
    isolatedStore();
    clearWeatherCache();
    process.env.GOOGLE_PLACES_API_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    vi.unstubAllGlobals();
  });

  it("surfaces the searched place first with a pinned reason", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      { match: urlContains("textsearch"), response: () => jsonResponse({ status: "ZERO_RESULTS", results: [] }) },
      { match: urlContains("nearbysearch"), response: () => jsonResponse({ status: "OK", results: [] }) },
      { match: urlContains("interpreter"), response: () => jsonResponse({ elements: [] }) },
    ]);
    const r = await recommend({
      lat: 36.6485,
      lng: 138.1949,
      budget: "afternoon",
      types: [],
      mode: "transit",
      pin: { name: "Café Misterio", lat: 36.6485, lng: 138.1949, typeId: "food" },
    });
    expect(r.places[0].name).toBe("Café Misterio");
    expect(r.places[0].reasons.map((x) => x.key)).toContain("pinned");
    expect(r.places[0].tags).toEqual(["food"]);
    expect(r.emptyReason).toBeUndefined();
  });

  it("prefers the Google twin (rich data) when discovery also found the place", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("textsearch"),
        response: () =>
          googleSearch([
            result("p1", "Edo-Tokyo Museum", {
              rating: 4.7,
              user_ratings_total: 5000,
              geometry: { location: { lat: 35.714, lng: 139.7798 } },
            }),
          ]),
      },
      { match: urlContains("nearbysearch"), response: () => jsonResponse({ status: "OK", results: [] }) },
      { match: urlContains("interpreter"), response: () => jsonResponse({ elements: [] }) },
    ]);
    const r = await recommend({
      lat: 35.714,
      lng: 139.7798,
      budget: "afternoon",
      types: [],
      mode: "transit",
      pin: { name: "Edo-Tokyo Museum", lat: 35.714, lng: 139.7798, typeId: "museum" },
    });
    expect(r.places[0].id).toBe("g_p1"); // Google's record, not the pin copy
    expect(r.places[0].rating).toBe(4.7);
    expect(r.places[0].reasons.map((x) => x.key)).toContain("pinned");
    expect(r.places.filter((p) => p.name === "Edo-Tokyo Museum")).toHaveLength(1);
  });

  it("synthesizes the pin when every source fails (never an empty result)", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      { match: urlContains("textsearch"), response: () => jsonResponse({ status: "REQUEST_DENIED", results: [] }) },
      { match: urlContains("nearbysearch"), response: () => jsonResponse({ status: "REQUEST_DENIED", results: [] }) },
      { match: urlContains("interpreter"), response: () => jsonResponse({}, 503) },
    ]);
    const r = await recommend({
      lat: 36.6485,
      lng: 138.1949,
      budget: "afternoon",
      types: [],
      mode: "transit",
      pin: { name: "Solo Pin", lat: 36.6485, lng: 138.1949 },
    });
    expect(r.places).toHaveLength(1);
    expect(r.places[0].name).toBe("Solo Pin");
    expect(r.emptyReason).toBeUndefined();
  });
});
