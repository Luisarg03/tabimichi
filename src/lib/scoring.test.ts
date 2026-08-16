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

  it("soft mode keeps closed places but sinks them with a reason", () => {
    const closed = place({ openNow: false, rating: 4.6, userRatingsTotal: 500 });
    const open = place({ openNow: true, rating: 4.6, userRatingsTotal: 500 });
    const out = scorePlaces([closed, open], ctx({ softClosed: true }));
    expect(out.map((p) => p.id)).toEqual([open.id, closed.id]);
    const closedOut = out.find((p) => p.id === closed.id)!;
    const openOut = out.find((p) => p.id === open.id)!;
    expect(closedOut.reasons.some((r) => r.key === "closedNow")).toBe(true);
    expect(closedOut.score).toBeLessThan(openOut.score);
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

describe("scorePlaces — noise penalties (chains & hotels)", () => {
  it("penalizes known chains with a reason", () => {
    const chain = place({ name: "Sukiya", tags: ["food"], rating: 4.0, userRatingsTotal: 1000, openNow: true });
    const local = place({ name: "Izakaya Tanaka", tags: ["food"], rating: 4.0, userRatingsTotal: 1000, openNow: true });
    const out = scorePlaces([chain, local], ctx());
    const byId = Object.fromEntries(out.map((p) => [p.id, p]));
    expect(byId[chain.id].reasons.some((r) => r.key === "chain")).toBe(true);
    expect(byId[chain.id].score).toBeLessThan(byId[local.id].score);
  });

  it("penalizes hotels but not ryokan-onsen", () => {
    const hotel = place({ name: "Marunouchi Hotel", tags: ["food"], rating: 4.2, userRatingsTotal: 300, openNow: true });
    const ryokan = place({ name: "Ryokan Sanga", tags: ["onsen"], rating: 4.6, userRatingsTotal: 200, openNow: true });
    const out = scorePlaces([hotel, ryokan], ctx());
    const byId = Object.fromEntries(out.map((p) => [p.id, p]));
    expect(byId[hotel.id].reasons.some((r) => r.key === "hotel")).toBe(true);
    expect(byId[ryokan.id].reasons.some((r) => r.key === "hotel")).toBe(false);
  });

  it("a highly rated local gem beats a mediocre chain at the same distance", () => {
    const gem = place({ name: "Kanda Shinoda", tags: ["food"], rating: 4.7, userRatingsTotal: 50, openNow: true });
    const chain = place({ name: "McDonald's", tags: ["food"], rating: 3.9, userRatingsTotal: 5000, openNow: true });
    const out = scorePlaces([chain, gem], ctx());
    expect(out[0].id).toBe(gem.id);
    expect(out[0].score - out[1].score).toBeGreaterThanOrEqual(10);
  });

  it("penalizes mediocre ratings", () => {
    const meh = place({ rating: 3.2, userRatingsTotal: 100, openNow: true });
    const ok = place({ rating: 4.2, userRatingsTotal: 100, openNow: true });
    const out = scorePlaces([meh, ok], ctx());
    const byId = Object.fromEntries(out.map((p) => [p.id, p]));
    expect(byId[ok.id].score).toBeGreaterThan(byId[meh.id].score + 10);
  });
});

describe("scorePlaces — interest keyword", () => {
  it("boosts keyword-matching places with a reason", () => {
    const match = place({ name: "Pokémon Center Tokyo", rating: 4.0, userRatingsTotal: 500, openNow: true });
    const other = place({ name: "Zenko-ji Temple", rating: 4.6, userRatingsTotal: 2000, openNow: true });
    const out = scorePlaces([match, other], ctx({ keyword: "pokemon" }));
    expect(out[0].id).toBe(match.id); // +20 boost beats the better-rated temple
    const m = out.find((p) => p.id === match.id)!;
    expect(m.reasons.some((r) => r.key === "keywordMatch" && r.params?.kw === "pokemon")).toBe(true);
  });

  it("exempts chains the user explicitly asked for", () => {
    const chain = place({ name: "Sukiya", tags: ["food"], rating: 4.0, userRatingsTotal: 1000, openNow: true });
    const out = scorePlaces([chain], ctx({ keyword: "sukiya" }));
    expect(out[0].reasons.some((r) => r.key === "chain")).toBe(false);
    // without keyword the same place is penalized
    const plain = scorePlaces([chain], ctx())[0];
    expect(plain.reasons.some((r) => r.key === "chain")).toBe(true);
  });

  it("counts keyword hits in stats", () => {
    const a = place({ name: "Snoopy Museum", openNow: true });
    const b = place({ name: "Zenko-ji", openNow: true });
    const stats = { closed: 0, tooFar: 0, nameMatches: 0 };
    scorePlaces([a, b], ctx({ keyword: "snoopy", stats }));
    expect(stats.nameMatches).toBe(1);
  });

  it("no keyword → identical ranking (no boost, no exemption)", () => {
    const chain = place({ name: "Sukiya", tags: ["food"], rating: 4.0, userRatingsTotal: 1000, openNow: true });
    const out = scorePlaces([chain], ctx());
    expect(out[0].reasons.some((r) => r.key === "keywordMatch")).toBe(false);
    expect(out[0].reasons.some((r) => r.key === "chain")).toBe(true);
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
