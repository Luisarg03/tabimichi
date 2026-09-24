import { describe, it, expect } from "vitest";
import { categoryOf, dayFactor, hourCurve, seasonFactor, weatherFactor } from "@/lib/crowd/curves";
import { bestHourToday, estimateCrowd, labelFor, popularityScores } from "@/lib/crowd/estimate";
import type { WeatherInfo } from "@/lib/types";

/** Weather fixture — only the fields the crowd model reads. */
const weather = (over: Partial<WeatherInfo> = {}): WeatherInfo => ({
  tempC: 20,
  feelsC: 20,
  precipMm: 0,
  snowCm: 0,
  windKmh: 5,
  code: 1,
  label: "Despejado",
  condition: "clear",
  isNight: false,
  hourly: [],
  daily: [],
  ...over,
});

/** Destination-local wall clock, app convention (local time in UTC fields). */
const local = (y: number, m: number, d: number, h: number) => new Date(Date.UTC(y, m - 1, d, h, 0));

describe("crowd curves", () => {
  it("maps experience tags to a crowd category", () => {
    expect(categoryOf(["temple"])).toBe("temple");
    expect(categoryOf(["food", "park"])).toBe("food");
    expect(categoryOf([])).toBe("other");
    expect(categoryOf(["nonsense"])).toBe("other");
  });

  it("peaks where the type actually peaks", () => {
    expect(hourCurve("temple", 12)).toBeGreaterThan(hourCurve("temple", 22));
    expect(hourCurve("market", 9)).toBeGreaterThan(hourCurve("market", 18));
    expect(hourCurve("nightlife", 23)).toBeGreaterThan(hourCurve("nightlife", 12));
    expect(hourCurve("nightlife", 1)).toBeGreaterThan(0); // wraps past midnight
    expect(hourCurve("museum", 3)).toBeLessThan(hourCurve("museum", 12));
  });

  it("weekends and holidays lift day-trip places more than restaurants", () => {
    expect(dayFactor("market", true)).toBeGreaterThan(dayFactor("market", false));
    expect(dayFactor("temple", true)).toBeGreaterThan(dayFactor("food", true));
  });

  it("rain moves people indoors instead of only removing them", () => {
    const rain = weather({ condition: "rain", precipMm: 3 });
    expect(weatherFactor("park", rain)).toBeLessThan(1);
    expect(weatherFactor("museum", rain)).toBeGreaterThan(1);
    expect(weatherFactor("park", weather())).toBe(1);
  });

  it("blossom season lifts sakura spots and parks, nothing else", () => {
    expect(seasonFactor("sakura", local(2026, 4, 2, 12))).toBe(1.5);
    expect(seasonFactor("park", local(2026, 4, 2, 12))).toBe(1.2);
    expect(seasonFactor("sakura", local(2026, 7, 2, 12))).toBe(1);
    expect(seasonFactor("museum", local(2026, 4, 2, 12))).toBe(1);
  });
});

describe("popularity", () => {
  it("ranks review volume, and falls back to the category prior without it", () => {
    const scores = popularityScores([
      { id: "big", tags: ["temple"], userRatingsTotal: 40_000 },
      { id: "small", tags: ["temple"], userRatingsTotal: 12 },
      { id: "osm-temple", tags: ["temple"] },
      { id: "osm-viewpoint", tags: ["viewpoint"] },
    ]);
    expect(scores.get("big")!).toBeGreaterThan(scores.get("small")!);
    // no reviews: a temple is assumed busier than a viewpoint, both below the magnet
    expect(scores.get("osm-temple")!).toBeGreaterThan(scores.get("osm-viewpoint")!);
    expect(scores.get("big")!).toBeGreaterThan(scores.get("osm-temple")!);
    for (const v of scores.values()) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is empty for an empty pool", () => {
    expect(popularityScores([]).size).toBe(0);
  });
});

describe("estimateCrowd", () => {
  const famousTemple = { tags: ["temple"], popularity: 0.95 };
  const quietMuseum = { tags: ["museum"], popularity: 0.3 };

  it("a famous temple at noon beats a small museum at 3am", () => {
    const busy = estimateCrowd(famousTemple, { now: local(2026, 6, 13, 12) });
    const dead = estimateCrowd(quietMuseum, { now: local(2026, 6, 13, 3) });
    expect(busy.level).toBeGreaterThan(dead.level);
    expect(busy.label).toBe("veryHigh");
    expect(dead.label).toBe("low");
  });

  it("reports the factors behind the number", () => {
    const weekend = estimateCrowd(famousTemple, {
      now: local(2026, 6, 13, 12),
      weather: weather({ condition: "rain", precipMm: 4 }),
    });
    expect(weekend.factors).toContain("weekend");
    expect(weekend.factors).toContain("rainOutdoor");
    expect(weekend.source).toBe("model");
  });

  it("a Japanese holiday counts as a weekend inside Japan", () => {
    const midTemple = { tags: ["temple"], popularity: 0.45 };
    const holiday = estimateCrowd(midTemple, { now: local(2026, 9, 21, 12), holiday: true });
    const plain = estimateCrowd(midTemple, { now: local(2026, 9, 21, 12) });
    expect(holiday.level).toBeGreaterThan(plain.level);
  });

  it("the user's own recent reports take over the estimate", () => {
    const now = local(2026, 6, 13, 12);
    const at = Date.now();
    const observed = estimateCrowd(famousTemple, {
      now,
      reports: [
        { placeId: "x", level: 0, at, localHour: 12, weekend: false },
        { placeId: "x", level: 0, at: at - 60_000, localHour: 12, weekend: false },
      ],
    });
    expect(observed.source).toBe("observed");
    expect(observed.level).toBeLessThan(0.3);
    expect(observed.observedAt).toBeDefined();
  });

  it("buckets labels at the documented thresholds", () => {
    expect(labelFor(0.1)).toBe("low");
    expect(labelFor(0.3)).toBe("medium");
    expect(labelFor(0.6)).toBe("high");
    expect(labelFor(0.9)).toBe("veryHigh");
  });
});

describe("bestHourToday", () => {
  it("picks the quietest hour still ahead, never the current one", () => {
    const hour = bestHourToday(
      { tags: ["temple"], popularity: 0.8 },
      { now: local(2026, 6, 10, 15) }
    );
    expect(hour).toBeGreaterThan(15);
    expect(hour).toBeLessThanOrEqual(23);
  });

  it("never suggests an hour the place is closed", () => {
    // Wednesday, open 09:00–17:00 (2026-06-10 is a Wednesday)
    const periods = [{ open: { day: 3, time: "0900" }, close: { day: 3, time: "1700" } }];
    const hour = bestHourToday(
      { tags: ["museum"], popularity: 0.5, periods },
      { now: local(2026, 6, 10, 9) }
    );
    expect(hour).toBeGreaterThanOrEqual(10);
    expect(hour).toBeLessThan(17);
  });

  it("returns nothing when the day is over", () => {
    expect(
      bestHourToday({ tags: ["temple"], popularity: 0.5 }, { now: local(2026, 6, 10, 23) })
    ).toBeUndefined();
  });
});
