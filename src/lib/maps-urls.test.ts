import { describe, it, expect } from "vitest";
import { dirsUrl, placeUrl } from "@/lib/maps-urls";

const PLACE_ID = "ChIJzyCiTOzzHWARH9aN73OLTfY";
const place = (over: Partial<{ name: string; googlePlaceId: string | null; lat: number; lng: number }> = {}) => ({
  name: "Wakasato Park",
  googlePlaceId: PLACE_ID,
  lat: 36.6409,
  lng: 138.1949,
  ...over,
});

describe("placeUrl", () => {
  it("opens the place directly via query_place_id (not a raw id in the search box)", () => {
    const url = placeUrl(place());
    expect(url).toBe(
      `https://www.google.com/maps/search/?api=1&query=Wakasato%20Park&query_place_id=${PLACE_ID}`
    );
  });

  it("falls back to a coordinate search without a google id", () => {
    expect(placeUrl(place({ googlePlaceId: null }))).toBe(
      "https://www.google.com/maps/search/?api=1&query=36.640900,138.194900"
    );
  });
});

describe("dirsUrl", () => {
  it("links the destination via destination_place_id + the name", () => {
    const url = dirsUrl({ lat: 36.6485, lng: 138.1949 }, place(), "walking");
    expect(url).toBe(
      `https://www.google.com/maps/dir/?api=1&origin=36.648500,138.194900` +
        `&destination=Wakasato%20Park&destination_place_id=${PLACE_ID}&travelmode=walking`
    );
    // the id stays raw — never %3A-encoded, never dropped into the query
    expect(url).not.toContain("%3A");
    expect(url).not.toContain("place_id:");
  });

  it("uses coordinates as destination without a google id", () => {
    expect(dirsUrl({ lat: 1, lng: 2 }, place({ googlePlaceId: null }), "walking")).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=1.000000,2.000000&destination=36.640900,138.194900&travelmode=walking"
    );
  });

  it("maps transport modes: car→driving, others pass through", () => {
    expect(dirsUrl({ lat: 1, lng: 2 }, place({ googlePlaceId: null }), "car")).toContain("travelmode=driving");
    expect(dirsUrl({ lat: 1, lng: 2 }, place({ googlePlaceId: null }), "transit")).toContain("travelmode=transit");
    expect(dirsUrl({ lat: 1, lng: 2 }, place({ googlePlaceId: null }), "walking")).toContain("travelmode=walking");
  });
});
