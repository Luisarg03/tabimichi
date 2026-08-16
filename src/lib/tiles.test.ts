import { describe, it, expect } from "vitest";
import { DEFAULT_TILE, TILE_STYLES, tileStyleById } from "@/lib/tiles";

describe("tiles", () => {
  it("exposes unique styles with valid tile URLs", () => {
    const ids = TILE_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of TILE_STYLES) {
      expect(s.url).toMatch(/\{z\}/);
      expect(s.url).toMatch(/\{x\}/);
      expect(s.url).toMatch(/\{y\}/);
      expect(s.attribution.length).toBeGreaterThan(10);
    }
  });

  it("defaults to the English-label layer", () => {
    expect(DEFAULT_TILE).toBe("esri");
    expect(tileStyleById(DEFAULT_TILE).id).toBe("esri");
  });

  it("falls back to the first style for unknown ids", () => {
    expect(tileStyleById("nope").id).toBe(TILE_STYLES[0].id);
  });
});
