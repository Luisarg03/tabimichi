import { describe, it, expect } from "vitest";
import { crowdCells } from "@/lib/crowd/heat";

/** Shibuya-ish reference point. */
const LAT = 35.6595;
const LNG = 139.7005;

describe("crowdCells", () => {
  it("puts the heaviest cell on the busiest cluster", () => {
    const cells = crowdCells([
      { lat: LAT, lng: LNG, weight: 1 },
      { lat: LAT + 0.004, lng: LNG + 0.004, weight: 0.4 },
    ]);
    expect(cells.length).toBeGreaterThan(0);
    const [lat, lng, w] = cells[0];
    expect(Math.abs(lat - LAT)).toBeLessThan(0.002);
    expect(Math.abs(lng - LNG)).toBeLessThan(0.002);
    expect(w).toBe(1); // normalized against the max
  });

  it("decays with distance from the source", () => {
    const cells = crowdCells([{ lat: LAT, lng: LNG, weight: 1 }], { sigmaM: 150, cellM: 100 });
    const near = cells.find((c) => Math.abs(c[0] - LAT) < 0.0005 && Math.abs(c[1] - LNG) < 0.0005);
    const far = cells.find((c) => Math.abs(c[0] - LAT) > 0.002);
    expect(near).toBeDefined();
    if (far) expect(far[2]).toBeLessThan(near![2]);
  });

  it("ignores zero-weight and broken points, and returns nothing for an empty pool", () => {
    expect(crowdCells([])).toEqual([]);
    expect(crowdCells([{ lat: LAT, lng: LNG, weight: 0 }])).toEqual([]);
    expect(crowdCells([{ lat: Number.NaN, lng: LNG, weight: 1 }])).toEqual([]);
  });

  it("stays within the cell budget", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      lat: LAT + (i % 20) * 0.0015,
      lng: LNG + Math.floor(i / 20) * 0.0015,
      weight: 0.5 + (i % 5) / 10,
    }));
    const cells = crowdCells(many, { maxCells: 50 });
    expect(cells.length).toBeLessThanOrEqual(50);
    // sorted heaviest first
    for (let i = 1; i < cells.length; i++) expect(cells[i][2]).toBeLessThanOrEqual(cells[i - 1][2]);
  });
});
