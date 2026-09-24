import { describe, it, expect } from "vitest";
import { hotZones } from "@/lib/crowd/zones";
import { labelFor } from "@/lib/crowd/estimate";

/** Shibuya-ish reference point. */
const LAT = 35.6595;
const LNG = 139.7005;

function cell(lat: number, lng: number, w: number): [number, number, number] {
  return [lat, lng, w];
}

describe("hotZones", () => {
  it("returns nothing for an empty pool or a cold field", () => {
    expect(hotZones([], [])).toEqual([]);
    expect(hotZones([cell(LAT, LNG, 0.2)], [], {})).toEqual([]);
    expect(hotZones([cell(Number.NaN, LNG, 1)], [])).toEqual([]);
  });

  it("clusters neighbouring hot cells into one zone, heaviest first", () => {
    const zones = hotZones(
      [
        cell(LAT, LNG, 1),
        cell(LAT + 0.001, LNG + 0.001, 0.9), // ~140 m away: same zone
        cell(LAT + 0.03, LNG + 0.03, 0.95), // ~4 km away: its own zone
      ],
      []
    );
    expect(zones.length).toBe(2);
    expect(zones[0].weight).toBe(1);
    expect(zones[1].weight).toBe(0.95);
    expect(zones[0].id).toBe("z1");
    expect(zones[0].label).toBe(labelFor(1));
    expect(zones[0].radiusM).toBeGreaterThanOrEqual(150);
    expect(zones[0].radiusM).toBeLessThanOrEqual(600);
  });

  it("ignores a lone lukewarm cell but keeps a lone screaming-hot one", () => {
    expect(hotZones([cell(LAT, LNG, 0.6)], [])).toEqual([]);
    const solo = hotZones([cell(LAT, LNG, 0.9)], []);
    expect(solo.length).toBe(1);
    expect(solo[0].placeIds).toEqual([]);
  });

  it("attaches member places within the radius, busiest first", () => {
    const zones = hotZones([cell(LAT, LNG, 1), cell(LAT + 0.001, LNG, 0.9)], [
      { id: "quiet", lat: LAT, lng: LNG, level: 0.3 },
      { id: "busy", lat: LAT + 0.0005, lng: LNG, level: 0.9 },
      { id: "far", lat: LAT + 0.5, lng: LNG, level: 1 },
    ]);
    expect(zones.length).toBe(1);
    expect(zones[0].placeIds).toEqual(["busy", "quiet"]);
  });

  it("caps the zone count and stays deterministic", () => {
    const cells = Array.from({ length: 30 }, (_, i) =>
      cell(LAT + i * 0.01, LNG, 0.6 + (i % 5) / 10)
    );
    const places = Array.from({ length: 30 }, (_, i) => ({
      id: `p${i}`,
      lat: LAT + i * 0.01,
      lng: LNG,
      level: 0.7,
    }));
    const a = hotZones(cells, places, { maxZones: 5 });
    const b = hotZones(cells, places, { maxZones: 5 });
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < a.length; i++) expect(a[i].weight).toBeLessThanOrEqual(a[i - 1].weight);
    for (const z of a) expect(z.label).toBe(labelFor(z.weight));
  });
});
