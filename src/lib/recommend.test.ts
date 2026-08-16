import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { emptyReasonFor, diversify, recommend } from "@/lib/recommend";
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
    daily: { time: ["2026-08-16"], weather_code: [1], temperature_2m_max: [28], temperature_2m_min: [20], precipitation_probability_max: [20] },
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
            u.includes("query=cat+near")
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
      { match: urlContains("interpreter"), response: () => jsonResponse({}, 500) },
    ]);
    const r = await recommend({ lat: 36.65, lng: 138.19, budget: "afternoon", types: ["park"], mode: "walking" });
    expect(r.places).toHaveLength(0);
    expect(r.emptyReason).toBe("no_results");
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
});
