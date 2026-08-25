import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as resolveGET } from "@/app/api/search/resolve/route";
import { resetRateLimits } from "@/lib/security";
import { mockFetch, jsonResponse, urlContains, isolatedStore } from "@/test-utils/helpers";

// BYOK: resolve spends the requesting user's Google key — stub getUserKeys
// with a fixture like the other route tests do.
const { resolveKeys } = vi.hoisted(() => ({
  resolveKeys: {
    googlePlacesApiKey: "AIza-resolve",
    geoapifyApiKey: "",
    opencodeApiKey: "",
    opencodeGoApiKey: "",
    overpassEndpoint: "",
  },
}));
vi.mock("@/lib/user-keys", () => ({
  getUserKeys: vi.fn(async () => ({ ...resolveKeys })),
}));

describe("GET /api/search/resolve", () => {
  beforeEach(() => {
    isolatedStore();
    resetRateLimits();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a prediction to coordinates + experience type", async () => {
    mockFetch([
      {
        match: urlContains("maps.googleapis.com/maps/api/place/details"),
        response: () =>
          jsonResponse({
            status: "OK",
            result: {
              name: "Edo-Tokyo Museum",
              geometry: { location: { lat: 35.714, lng: 139.7798 } },
              types: ["museum", "tourist_attraction"],
            },
          }),
      },
    ]);
    const res = await resolveGET(new NextRequest("http://x/api/search/resolve?placeId=gm1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "Edo-Tokyo Museum",
      lat: 35.714,
      lng: 139.7798,
      typeId: "museum",
    });
  });

  it("rejects missing placeId and returns 404 when Google has no such place", async () => {
    expect((await resolveGET(new NextRequest("http://x/api/search/resolve"))).status).toBe(400);
    mockFetch([
      {
        match: urlContains("maps.googleapis.com/maps/api/place/details"),
        response: () => jsonResponse({ status: "NOT_FOUND", result: {} }),
      },
    ]);
    expect(
      (await resolveGET(new NextRequest("http://x/api/search/resolve?placeId=nope"))).status
    ).toBe(404);
  });

  it("returns 502 when the Google call itself fails", async () => {
    mockFetch([
      {
        match: urlContains("maps.googleapis.com/maps/api/place/details"),
        response: () => jsonResponse({}, 500),
      },
    ]);
    const res = await resolveGET(new NextRequest("http://x/api/search/resolve?placeId=gm1"));
    expect(res.status).toBe(502);
  });
});
