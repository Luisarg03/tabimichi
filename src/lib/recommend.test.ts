import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { emptyReasonFor, recommend } from "@/lib/recommend";
import { clearWeatherCache } from "@/lib/weather";
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

  it("returns places in real mode (closed ones filtered)", async () => {
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
    expect(r.places.map((p) => p.id)).toEqual(["g_p1"]);
    expect(r.emptyReason).toBeUndefined();
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
