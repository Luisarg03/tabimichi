import { describe, it, expect } from "vitest";
import { placeQueryFor, dirsUrl, placeUrl } from "@/lib/maps-urls";

const PLACE_ID = "ChIJzyCiTOzzHWARH9aN73OLTfY";

describe("placeQueryFor", () => {
  it("uses the raw place_id prefix when available", () => {
    expect(placeQueryFor(PLACE_ID, 36.64, 138.18)).toBe(`place_id:${PLACE_ID}`);
  });

  it("falls back to coordinates without a google id", () => {
    expect(placeQueryFor(null, 36.6485, 138.1949)).toBe("36.648500,138.194900");
  });
});

describe("dirsUrl", () => {
  it("keeps the place_id colon RAW (encoded colons break Google's parser)", () => {
    const url = dirsUrl({ lat: 36.6485, lng: 138.1949 }, `place_id:${PLACE_ID}`, "walking");
    expect(url).toBe(
      `https://www.google.com/maps/dir/?api=1&origin=36.648500,138.194900&destination=place_id:${PLACE_ID}&travelmode=walking`
    );
    expect(url).not.toContain("%3A");
  });

  it("maps transport modes: car→driving, others pass through", () => {
    expect(dirsUrl({ lat: 1, lng: 2 }, "1,2", "car")).toContain("travelmode=driving");
    expect(dirsUrl({ lat: 1, lng: 2 }, "1,2", "transit")).toContain("travelmode=transit");
    expect(dirsUrl({ lat: 1, lng: 2 }, "1,2", "walking")).toContain("travelmode=walking");
  });
});

describe("placeUrl", () => {
  it("opens the place panel for place ids", () => {
    expect(placeUrl(`place_id:${PLACE_ID}`)).toBe(
      `https://www.google.com/maps/place/?q=place_id:${PLACE_ID}`
    );
  });

  it("falls back to a coordinate search", () => {
    expect(placeUrl("36.648500,138.194900")).toBe(
      "https://www.google.com/maps/search/?api=1&query=36.648500,138.194900"
    );
  });
});
