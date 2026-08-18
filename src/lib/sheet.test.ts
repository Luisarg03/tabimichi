import { describe, expect, it } from "vitest";
import {
  SNAP_ORDER,
  FULL_RATIO,
  LIST_RATIO,
  PEEK_H,
  dragVelocity,
  resolveSnap,
  snapTop,
} from "@/lib/sheet";

const VH = 800;
const SAFE = 0;

describe("snapTop", () => {
  it("orders snaps from most closed to most open (descending tops)", () => {
    const tops = SNAP_ORDER.map((s) => snapTop(s, VH, SAFE));
    expect(tops).toEqual([...tops].sort((a, b) => b - a));
  });

  it("hidden sits fully below the viewport", () => {
    expect(snapTop("hidden", VH, SAFE)).toBe(VH);
  });

  it("peek keeps the handle row visible", () => {
    expect(snapTop("peek", VH, SAFE)).toBe(VH - PEEK_H);
  });

  it("list and full cover the configured fractions", () => {
    expect(snapTop("list", VH, SAFE)).toBe(VH - Math.round(VH * LIST_RATIO));
    expect(snapTop("full", VH, SAFE)).toBe(VH - Math.round(VH * FULL_RATIO));
  });

  it("accounts for the safe-area inset", () => {
    expect(snapTop("peek", VH, 34)).toBe(VH - PEEK_H - 34);
  });
});

describe("resolveSnap", () => {
  it("stays put on tiny drags (nearest wins)", () => {
    expect(resolveSnap("list", 5, VH, SAFE)).toBe("list");
    expect(resolveSnap("full", -4, VH, SAFE)).toBe("full");
  });

  it("long drag up opens one step", () => {
    expect(resolveSnap("hidden", -200, VH, SAFE)).toBe("peek");
    expect(resolveSnap("peek", -300, VH, SAFE)).toBe("list");
    expect(resolveSnap("list", -400, VH, SAFE)).toBe("full");
  });

  it("long drag down closes one step", () => {
    expect(resolveSnap("full", 400, VH, SAFE)).toBe("list");
    expect(resolveSnap("list", 300, VH, SAFE)).toBe("peek");
    expect(resolveSnap("peek", 200, VH, SAFE)).toBe("hidden");
  });

  it("clamps at the extremes", () => {
    expect(resolveSnap("hidden", -2000, VH, SAFE)).toBe("peek");
    expect(resolveSnap("full", 2000, VH, SAFE)).toBe("list");
  });

  it("snaps to the nearest open/closed neighbor when dragging just past the midpoint", () => {
    // dragging list up by 55% of the distance to full → full
    const from = snapTop("list", VH, SAFE);
    const to = snapTop("full", VH, SAFE);
    const dy = -(from - to) * 0.6;
    expect(resolveSnap("list", dy, VH, SAFE)).toBe("full");
  });

  it("a fast fling wins even on a short drag", () => {
    // small drag but high velocity down → closes
    expect(resolveSnap("list", 12, VH, SAFE, 1.2)).toBe("peek");
    // small drag but high velocity up → opens
    expect(resolveSnap("list", -12, VH, SAFE, -1.2)).toBe("full");
  });
});

describe("dragVelocity", () => {
  it("returns 0 with fewer than two samples", () => {
    expect(dragVelocity([])).toBe(0);
    expect(dragVelocity([{ t: 0, y: 10 }])).toBe(0);
  });

  it("computes px/ms between first and last sample", () => {
    const v = dragVelocity([
      { t: 0, y: 0 },
      { t: 100, y: 50 },
      { t: 200, y: 150 },
    ]);
    expect(v).toBeCloseTo(0.75);
  });

  it("is negative when dragging up (opening)", () => {
    const v = dragVelocity([
      { t: 0, y: 200 },
      { t: 100, y: 100 },
    ]);
    expect(v).toBeLessThan(0);
  });
});
