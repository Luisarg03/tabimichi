import { describe, expect, it } from "vitest";
import { RING_CIRCUMFERENCE, ringOffset } from "./ring";

describe("ring", () => {
  it("full score → zero offset (full ring)", () => {
    expect(ringOffset(100)).toBeCloseTo(0, 6);
  });

  it("zero score → full offset (empty ring)", () => {
    expect(ringOffset(0)).toBeCloseTo(RING_CIRCUMFERENCE, 6);
  });

  it("half score → half circumference offset", () => {
    expect(ringOffset(50)).toBeCloseTo(RING_CIRCUMFERENCE / 2, 6);
  });

  it("clamps out-of-range scores", () => {
    expect(ringOffset(150)).toBe(0);
    expect(ringOffset(-5)).toBe(RING_CIRCUMFERENCE);
    expect(ringOffset(NaN)).toBe(RING_CIRCUMFERENCE);
  });
});
