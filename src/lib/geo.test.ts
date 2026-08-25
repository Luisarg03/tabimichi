import { describe, it, expect } from "vitest";
import { haversineKm, travelMin, radiusForBudget, BUDGET_MIN, DEFAULT_LOCATION } from "@/lib/geo";

describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineKm({ lat: 36.6485, lng: 138.1949 }, { lat: 36.6485, lng: 138.1949 })).toBe(0);
  });

  it("measures Nagano Station → Zenko-ji (~1.6 km)", () => {
    const km = haversineKm(
      { lat: 36.6485, lng: 138.1949 },
      { lat: 36.6615752, lng: 138.1877028 }
    );
    expect(km).toBeGreaterThan(1.2);
    expect(km).toBeLessThan(2.1);
  });

  it("is symmetric", () => {
    const a = { lat: 34.7, lng: 135.5 };
    const b = { lat: 36.6, lng: 138.1 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});

describe("travelMin", () => {
  it("walks 4.5 km/h with a 1.25 detour factor: 3 km ≈ 50 min", () => {
    expect(travelMin(3, "walking")).toBe(50);
  });

  it("transit adds wait overhead and a 1.5 route factor", () => {
    expect(travelMin(3, "transit")).toBeGreaterThan(travelMin(3, "car"));
    expect(travelMin(3, "transit")).toBe(18); // 3*1.5/28*60 + 8 ≈ 17.6 → 18
  });

  it("car is fastest", () => {
    expect(travelMin(10, "car")).toBeLessThan(travelMin(10, "transit"));
  });

  it("walking caps at 240 min", () => {
    expect(travelMin(50, "walking")).toBe(240);
  });

  it("tiny distances are at least 1 minute", () => {
    expect(travelMin(0.01, "walking")).toBeGreaterThanOrEqual(1);
  });
});

describe("radiusForBudget", () => {
  it("scales by transport mode", () => {
    // walking = "around the point" — tight explicit radii, never 5+ km
    expect(radiusForBudget("lunch", "walking")).toBe(1.5);
    expect(radiusForBudget("afternoon", "walking")).toBe(2.5);
    expect(radiusForBudget("full_day", "walking")).toBe(3.5);
    expect(radiusForBudget("lunch", "transit")).toBe(5);
    expect(radiusForBudget("afternoon", "transit")).toBe(12);
    expect(radiusForBudget("lunch", "car")).toBe(10);
    expect(radiusForBudget("full_day", "car")).toBe(70);
  });
});

describe("BUDGET_MIN", () => {
  it("has sane budgets", () => {
    expect(BUDGET_MIN.lunch).toBe(90);
    expect(BUDGET_MIN.afternoon).toBe(300);
    expect(BUDGET_MIN.full_day).toBe(600);
  });
});

describe("DEFAULT_LOCATION", () => {
  it("is Tokyo Station", () => {
    expect(DEFAULT_LOCATION.lat).toBeGreaterThan(35.6);
    expect(DEFAULT_LOCATION.lat).toBeLessThan(35.8);
    expect(DEFAULT_LOCATION.lng).toBeGreaterThan(139.6);
    expect(DEFAULT_LOCATION.lng).toBeLessThan(139.9);
  });
});
