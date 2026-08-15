import { describe, it, expect } from "vitest";
import { scorePlaces } from "@/lib/scoring";
import type { Place, WeatherInfo } from "@/lib/types";

const weather = (over: Partial<WeatherInfo> = {}): WeatherInfo => ({
  tempC: 20,
  feelsC: 20,
  precipMm: 0,
  snowCm: 0,
  windKmh: 5,
  code: 1,
  label: "cloudy",
  condition: "cloudy",
  isNight: false,
  hourly: [],
  daily: [],
  ...over,
});

let seq = 0;
const place = (over: Partial<Place> = {}): Place => ({
  id: `p${seq++}`,
  source: "google",
  name: "Test",
  lat: 36.65,
  lng: 138.19,
  tags: ["park"],
  ...over,
});

const ctx = (over: Record<string, unknown> = {}) => ({
  base: { lat: 36.6485, lng: 138.1949 },
  budgetMin: 300,
  weather: weather(),
  now: new Date(),
  ...over,
});

describe("scorePlaces — hard filters", () => {
  it("drops places beyond maxDistKm", () => {
    const far = place({ lat: 36.9, lng: 138.5 }); // ~40 km
    const near = place({ lat: 36.649, lng: 138.195 });
    const out = scorePlaces([far, near], ctx({ maxDistKm: 10 }));
    expect(out.map((p) => p.id)).toEqual([near.id]);
  });

  it("drops places too far for the budget", () => {
    const out = scorePlaces([place({ lat: 36.9, lng: 138.5 })], ctx({ budgetMin: 60 }));
    expect(out).toHaveLength(0);
  });

  it("never recommends closed places", () => {
    const closed = place({ openNow: false });
    const open = place({ openNow: true });
    const unknown = place({ openNow: null });
    const out = scorePlaces([closed, open, unknown], ctx());
    expect(out.map((p) => p.id)).toEqual([open.id, unknown.id]);
  });
});

describe("scorePlaces — travel bands", () => {
  it("close beats far when both exist", () => {
    const close = place({ lat: 36.6488, lng: 138.195 }); // ~0.03 km
    const far = place({ lat: 36.69, lng: 138.23 }); // ~5.5 km
    const out = scorePlaces([far, close], ctx());
    expect(out[0].id).toBe(close.id);
    expect(out[0].score).toBeGreaterThan(out[1].score);
    expect(out[0].reasons.some((r) => r.key === "distanceGood")).toBe(true);
  });
});

describe("scorePlaces — weather fit", () => {
  it("rain boosts indoor types with a reason", () => {
    const museum = place({ tags: ["museum"] });
    const out = scorePlaces([museum], ctx({ weather: weather({ condition: "rain" }) }));
    expect(out[0].reasons.some((r) => r.key === "weatherRainIndoor")).toBe(true);
  });

  it("rain penalizes outdoor harder on foot", () => {
    const park = place({ tags: ["park"] });
    const onFoot = scorePlaces([park], ctx({ weather: weather({ condition: "rain" }), mode: "walking" }))[0];
    const byCar = scorePlaces([park], ctx({ weather: weather({ condition: "rain" }), mode: "car" }))[0];
    expect(onFoot.score).toBeLessThan(byCar.score);
  });

  it("snow boosts onsen with a reason", () => {
    const onsen = place({ tags: ["onsen"] });
    const out = scorePlaces([onsen], ctx({ weather: weather({ condition: "snow" }) }));
    expect(out[0].reasons.some((r) => r.key === "weatherSnowOnsen")).toBe(true);
  });

  it("clear weather boosts viewpoints", () => {
    const viewpoint = place({ tags: ["viewpoint"] });
    const out = scorePlaces([viewpoint], ctx({ weather: weather({ condition: "clear" }) }));
    expect(out[0].reasons.some((r) => r.key === "weatherGoodOutdoor")).toBe(true);
  });
});

describe("scorePlaces — rating & reviews", () => {
  it("shrinks ratings with few reviews (Bayesian)", () => {
    const few = place({ rating: 4.5, userRatingsTotal: 5 });
    const out = scorePlaces([few], ctx());
    // (4.5*5 + 3.9*30)/35 ≈ 3.99 → not in the 4.4+ band
    expect(out[0].reasons.some((r) => r.key === "highRated")).toBe(false);
  });

  it("keeps ratings with many reviews", () => {
    const many = place({ rating: 4.6, userRatingsTotal: 2000 });
    const out = scorePlaces([many], ctx());
    expect(out[0].reasons.some((r) => r.key === "highRated")).toBe(true);
  });

  it("adds a popularity reason for very reviewed places", () => {
    const popular = place({ rating: 4.0, userRatingsTotal: 6000 });
    const out = scorePlaces([popular], ctx());
    expect(out[0].reasons.some((r) => r.key === "popular")).toBe(true);
  });

  it("does not boost unreviewed places", () => {
    const plain = place({ rating: 4.0 });
    const out = scorePlaces([plain], ctx());
    expect(out[0].reasons.some((r) => r.key === "popular")).toBe(false);
  });
});

describe("scorePlaces — profile affinity", () => {
  it("boosts liked tags with a reason", () => {
    const onsen = place({ tags: ["onsen"] });
    const out = scorePlaces([onsen], ctx({ profile: { onsen: 2 } }));
    expect(out[0].reasons.some((r) => r.key === "profileLiked")).toBe(true);
    const neutral = scorePlaces([onsen], ctx());
    expect(out[0].score).toBeGreaterThan(neutral[0].score);
  });

  it("penalizes disliked tags", () => {
    const park = place({ tags: ["park"] });
    const liked = scorePlaces([park], ctx({ profile: { park: -3 } }))[0];
    const neutral = scorePlaces([park], ctx())[0];
    expect(liked.score).toBeLessThan(neutral.score);
  });

  it("clamps affinity", () => {
    const onsen = place({ tags: ["onsen"] });
    const out = scorePlaces([onsen], ctx({ profile: { onsen: 50 } }))[0];
    expect(out.score).toBeLessThanOrEqual(100);
  });
});

describe("scorePlaces — sorting", () => {
  it("sorts by score desc, then travel asc", () => {
    const a = place({ lat: 36.649, lng: 138.195, rating: 4.9, userRatingsTotal: 1000 });
    const b = place({ lat: 36.6487, lng: 138.195 });
    const out = scorePlaces([b, a], ctx());
    expect(out[0].id).toBe(a.id);
  });
});
