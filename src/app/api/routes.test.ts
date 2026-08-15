import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import path from "node:path";
import { existsSync } from "node:fs";
import { POST as recommendPOST } from "@/app/api/recommend/route";
import { POST as feedbackPOST, GET as feedbackGET } from "@/app/api/feedback/route";
import { GET as settingsGET, POST as settingsPOST } from "@/app/api/settings/route";
import { GET as geocodeGET } from "@/app/api/geocode/route";
import { GET as photoGET } from "@/app/api/photo/route";
import { GET as photosGET } from "@/app/api/photos/route";
import { GET as logsGET } from "@/app/api/logs/route";
import { geocodeVariants } from "@/app/api/geocode/route";
import { logEntry } from "@/lib/logger";
import { upsertPlace } from "@/lib/db";
import { clearWeatherCache } from "@/lib/weather";
import { setPhotoDir } from "@/lib/photos";
import { mockFetch, jsonResponse, imageResponse, urlContains, isolatedStore } from "@/test-utils/helpers";

const KEY = "AIza-test";

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

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

const googleResult = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  place_id: id,
  name,
  geometry: { location: { lat: 36.65, lng: 138.19 } },
  rating: 4.3,
  user_ratings_total: 100,
  photos: [{ photo_reference: `ref-${id}` }],
  ...over,
});

const googleSearchResponse = () =>
  jsonResponse({
    status: "OK",
    results: [
      googleResult("p1", "Parque A", { opening_hours: { open_now: true } }),
      googleResult("p2", "Museo B", { opening_hours: { open_now: false } }),
    ],
  });

beforeEach(() => {
  isolatedStore();
  setPhotoDir(path.join(process.env.TABI_DATA_DIR!, "photos"));
  clearWeatherCache();
  process.env.GOOGLE_PLACES_API_KEY = KEY;
});

afterEach(() => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.OPENCODE_API_KEY;
  delete process.env.OPENCODE_GO_API_KEY;
  vi.unstubAllGlobals();
});

describe("/api/recommend", () => {
  it("returns scored places, excluding closed ones", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      { match: urlContains("textsearch"), response: googleSearchResponse },
      { match: urlContains("nearbysearch"), response: () => jsonResponse({ status: "OK", results: [] }) },
    ]);
    const res = await recommendPOST(
      post("http://localhost/api/recommend", { lat: 36.65, lng: 138.19, budget: "afternoon", types: ["park", "museum"], mode: "walking" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.places.length).toBe(1); // p2 is closed → dropped
    expect(body.places[0].id).toBe("g_p1");
    expect(body.narrated).toBe(false);
  });

  it("validates inputs", async () => {
    const noLat = await recommendPOST(post("http://localhost/api/recommend", { lng: 138, budget: "lunch" }));
    expect(noLat.status).toBe(400);
    const badMode = await recommendPOST(
      post("http://localhost/api/recommend", { lat: 36, lng: 138, budget: "lunch", mode: "jetpack" })
    );
    expect(badMode.status).toBe(400);
    const badNow = await recommendPOST(
      post("http://localhost/api/recommend", { lat: 36, lng: 138, budget: "lunch", now: "not-a-date" })
    );
    expect(badNow.status).toBe(400);
  });

  it("simulates a time slot: evaluates opening hours locally", async () => {
    mockFetch([
      { match: urlContains("open-meteo.com"), response: weatherFixture },
      {
        match: urlContains("textsearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              googleResult("p1", "Café", { opening_hours: { open_now: true } }),
              googleResult("p2", "Bar Late", { opening_hours: { open_now: true } }),
            ],
          }),
      },
      { match: urlContains("nearbysearch"), response: () => jsonResponse({ status: "OK", results: [] }) },
      // Place Details: café closes at 21:00; bar closes at 02:00 (overnight)
      {
        match: (u) => u.includes("details/json"),
        response: (u: string) => {
          const placeId = u.match(/place_id=(p\d)/)?.[1] ?? "p1";
          return jsonResponse({
            status: "OK",
            result: {
              photos: [],
              opening_hours: {
                periods:
                  placeId === "p2"
                    ? [{ open: { day: 0, time: "2000" }, close: { day: 1, time: "0200" } }]
                    : [{ open: { day: 0, time: "0900" }, close: { day: 0, time: "2100" } }],
              },
            },
          });
        },
      },
    ]);
    // Sunday 21:00 JST — encoded as the client does: Date.UTC(y,m,d,hourJST)
    const res = await recommendPOST(
      post("http://localhost/api/recommend", {
        lat: 36.65, lng: 138.19, budget: "afternoon", types: ["food", "nightlife"], mode: "walking",
        now: "2026-08-16T21:00:00.000Z",
      })
    );
    const body = await res.json();
    // café closed at 21:00 → only the late bar survives
    expect(body.places.map((p: { id: string }) => p.id)).toEqual(["g_p2"]);
    expect(body.places[0].openNow).toBe(true);
  });
});

describe("/api/logs", () => {
  it("returns persisted entries newest-first", async () => {
    logEntry({ type: "recommend", lat: 36.6, scored: 8 });
    logEntry({ type: "recommend", lat: 34.7, scored: 0, emptyReason: "all_closed" });
    const res = await logsGET(new NextRequest("http://localhost/api/logs?tail=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].emptyReason).toBe("all_closed"); // newest first
  });

  it("filters entries by traceId", async () => {
    logEntry({ type: "recommend", traceId: "tr_a", scored: 8 });
    logEntry({ type: "narrate", traceId: "tr_a", provider: "opencode-go" });
    logEntry({ type: "recommend", traceId: "tr_b", scored: 0 });
    const res = await logsGET(new NextRequest("http://localhost/api/logs?tail=20&trace=tr_a"));
    const body = await res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries.every((e: { traceId: string }) => e.traceId === "tr_a")).toBe(true);
  });
});

describe("/api/feedback", () => {
  it("votes and returns the updated profile", async () => {
    upsertPlace({ id: "g_v1", source: "google", name: "Onsen", lat: 36, lng: 138, tags: ["onsen"], openNow: null });
    const res = await feedbackPOST(post("http://localhost/api/feedback", { placeId: "g_v1", liked: true, tags: ["onsen"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.onsen).toBe(1);

    const get = await feedbackGET();
    const got = await get.json();
    expect(got.profile.onsen).toBe(1);
  });

  it("rejects invalid votes", async () => {
    const res = await feedbackPOST(post("http://localhost/api/feedback", { placeId: "" }));
    expect(res.status).toBe(400);
  });
});

describe("/api/settings", () => {
  it("persists keys and only exposes booleans", async () => {
    const set = await settingsPOST(post("http://localhost/api/settings", { googlePlacesApiKey: "AIza-x" }));
    expect(set.status).toBe(200);
    const body = await set.json();
    expect(body.googlePlacesApiKey).toBe(true);
    expect(body.opencodeGoApiKey).toBe(false);
  });
});

describe("geocodeVariants", () => {
  it("strips block numbers from street tokens", () => {
    const v = geocodeVariants("Kitaishidocho-1373 Minaminagano, Nagano, 380-0826, Japón");
    expect(v[0]).toBe("Kitaishidocho-1373 Minaminagano, Nagano, 380-0826, Japón");
    expect(v[1]).toBe("Kitaishidocho Minaminagano, Nagano, 380-0826, Japón");
  });

  it("falls back to the rest of the address, the zip, and the tail", () => {
    const v = geocodeVariants("Kitaishidocho-1373, Nagano, 380-0826, Japón");
    expect(v).toContain("Kitaishidocho, Nagano, 380-0826, Japón"); // street + rest
    expect(v).toContain("Nagano, 380-0826, Japón"); // rest
    expect(v).toContain("380-0826, Japan"); // zip
    expect(v).toContain("380-0826, Japón"); // last two
  });

  it("dedupes variants", () => {
    const v = geocodeVariants("Nagano, 380-0826, Japan");
    expect(new Set(v).size).toBe(v.length);
  });
});

describe("/api/geocode", () => {
  it("returns coordinates from Nominatim", async () => {
    mockFetch([
      {
        match: urlContains("nominatim.openstreetmap.org"),
        response: () =>
          jsonResponse([{ lat: "34.7047", lon: "135.4943", display_name: "Ofukacho, Osaka", name: "Ofukacho" }]),
      },
    ]);
    const res = await geocodeGET(new NextRequest("http://localhost/api/geocode?q=Ofukacho"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lat).toBe(34.7047);
  });

  it("404s when not found", async () => {
    mockFetch([{ match: urlContains("nominatim"), response: () => jsonResponse([]) }]);
    const res = await geocodeGET(new NextRequest("http://localhost/api/geocode?q=xyz"));
    expect(res.status).toBe(404);
  });

  it("falls back to a stripped variant when the raw query fails", async () => {
    let calls = 0;
    mockFetch([
      {
        match: urlContains("nominatim"),
        response: () => {
          calls++;
          // first variant (raw address with block number) fails, next resolves
          return calls === 1
            ? jsonResponse([])
            : jsonResponse([{ lat: "36.6462", lon: "138.1848", display_name: "北石堂町, 長野市, 長野県, 日本", name: "北石堂町" }]);
        },
      },
    ]);
    const res = await geocodeGET(
      new NextRequest("http://localhost/api/geocode?q=" + encodeURIComponent("Kitaishidocho-1373 Minaminagano, Nagano, 380-0826, Japón"))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lat).toBe(36.6462);
    expect(calls).toBeGreaterThan(1); // tried more than the raw query
  });
});

describe("/api/photo", () => {
  it("proxies and caches on disk (one google call for two requests)", async () => {
    const fn = mockFetch([
      {
        match: urlContains("maps.googleapis.com/maps/api/place/photo"),
        response: () => imageResponse([1, 2, 3, 4]),
      },
    ]);
    const url = "http://localhost/api/photo?ref=refA&id=g_p1";
    const first = await photoGET(new NextRequest(url));
    expect(first.status).toBe(200);
    const second = await photoGET(new NextRequest(url));
    expect(second.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1); // second served from disk
    const cacheFile = path.join(process.env.TABI_DATA_DIR!, "photos", "g_p1__refA.jpg");
    expect(existsSync(cacheFile)).toBe(true);
  });

  it("rejects missing ref", async () => {
    const res = await photoGET(new NextRequest("http://localhost/api/photo"));
    expect(res.status).toBe(400);
  });
});

describe("/api/photos", () => {
  it("dedupes by content hash and marks the place verified", async () => {
    let detailsCalls = 0;
    mockFetch([
      {
        match: urlContains("details/json"),
        response: () => {
          detailsCalls++;
          return jsonResponse({
            status: "OK",
            result: { photos: [{ photo_reference: "r1" }, { photo_reference: "r2" }, { photo_reference: "r3" }] },
          });
        },
      },
      {
        match: urlContains("place/photo"),
        response: (u: string) => {
          const ref = new URL(u).searchParams.get("photo_reference") ?? "";
          return imageResponse(ref === "r3" ? [9, 9, 9] : [1, 2, 3]); // r1/r2 same image
        },
      },
    ]);
    upsertPlace({ id: "g_d1", source: "google", name: "Lugar", lat: 36, lng: 138, tags: ["park"], openNow: null });

    const first = await photosGET(new NextRequest("http://localhost/api/photos?ids=g_d1"));
    const body = await first.json();
    expect(body.photos.g_d1).toEqual(["r1", "r3"]); // r2 duplicated r1 → dropped
    expect(detailsCalls).toBe(1);

    const second = await photosGET(new NextRequest("http://localhost/api/photos?ids=g_d1"));
    const body2 = await second.json();
    expect(body2.photos.g_d1).toEqual(["r1", "r3"]);
    expect(detailsCalls).toBe(1); // verified → skipped
  });
});
