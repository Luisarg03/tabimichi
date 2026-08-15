import { describe, it, expect } from "vitest";
import { fmtCount } from "@/lib/format";

describe("fmtCount", () => {
  it("keeps small numbers", () => {
    expect(fmtCount(0)).toBe("0");
    expect(fmtCount(999)).toBe("999");
  });

  it("formats thousands with one decimal", () => {
    expect(fmtCount(1000)).toBe("1.0k");
    expect(fmtCount(1234)).toBe("1.2k");
    expect(fmtCount(9999)).toBe("10.0k");
  });

  it("rounds tens of thousands", () => {
    expect(fmtCount(10000)).toBe("10k");
    expect(fmtCount(12500)).toBe("13k");
    expect(fmtCount(90502)).toBe("91k");
  });
});
