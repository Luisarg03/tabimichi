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

  it("drops places beyond the mode travel cap", () => {
    // transit cap 90 min: ~40 km ≈ 94 min → dropped
    const out = scorePlaces([place({ lat: 36.9, lng: 138.5 })], ctx({}));
    expect(out).toHaveLength(0);
  });

  it("drops far places in walking mode that transit would accept", () => {
    const far = place({ lat: 36.69, lng: 138.23 }); // ~5.5 km
    // walking: 5.5 km ≈ 73 min on foot > 45 min cap → dropped ("around me" only)
    expect(scorePlaces([far], ctx({ mode: "walking" }))).toHaveLength(0);
    // transit: 5.5 km ≈ 20 min < 90 min cap → accepted
    expect(scorePlaces([far], ctx({ mode: "transit" }))).toHaveLength(1);
  });

  it("caps travel per mode: transit takes 61 min trips, walking does not", () => {
    const mid = place({ lat: 36.69, lng: 138.23 }); // ~5.5 km ≈ 20 min transit
    const far = place({ lat: 36.95, lng: 138.55 }); // ~40 km ≈ 136 min transit
    expect(scorePlaces([mid, far], ctx({ mode: "transit" })).map((p) => p.id)).toEqual([mid.id]);
    expect(scorePlaces([mid, far], ctx({ mode: "walking" }))).toHaveLength(0);
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

  it("drops hotel dining rooms from a food search but keeps ryokan-onsen", () => {
    // Google types hotels as "restaurant" when they serve breakfast; the user
    // reported seeing "Hotel … Dining" in the food list. A hard filter is
    // correct here — a hotel is not a place you go to eat — while a ryokan
    // with a bath stays, because that IS a destination for this app.
    const hotel = place({ name: "Marunouchi Hotel", tags: ["food"], rating: 4.2, userRatingsTotal: 300, openNow: true });
    const dining = place({ name: "All Day Dining Jurin", tags: ["food"], rating: 4.2, userRatingsTotal: 1074, openNow: true });
    const karaoke = place({ name: "Karaoke Pasela Shinjuku Honten", tags: ["food", "nightlife"], rating: 4.3, userRatingsTotal: 1358, openNow: true });
    const ryokan = place({ name: "Ryokan Sanga", tags: ["onsen"], rating: 4.6, userRatingsTotal: 200, openNow: true });
    const out = scorePlaces([hotel, dining, karaoke, ryokan], ctx({ types: ["food"] }));
    expect(out.map((p) => p.id)).toEqual([ryokan.id]);
  });

  it("keeps a food place whose name merely contains a lodging word elsewhere", () => {
    // the filter is name-anchored, so a normal restaurant is untouched
    const soba = place({ name: "信州そば本陣", tags: ["food"], rating: 4.4, userRatingsTotal: 400, openNow: true });
    const out = scorePlaces([soba], ctx({ types: ["food"] }));
    expect(out.map((p) => p.id)).toEqual([soba.id]);
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

  it("a rated place nearby beats an unrated one a few steps closer (best-of-nearby)", () => {
    // Standing at Kamakura station: the OSM row at 100 m has no rating at all,
    // the Google one at 500 m has 4.5/124. The user asked for "lo mejor de lo
    // mejor cerca" — the rated place must win, or the list is arbitrary.
    const unrated = place({
      id: "osm-close", source: "overpass", name: "裏町食堂",
      lat: 36.6494, lng: 138.1954, tags: ["food"], openNow: null,
    });
    const rated = place({
      id: "google-500m", source: "google", name: "Poiger",
      lat: 36.6533, lng: 138.1949, tags: ["food"], rating: 4.5, userRatingsTotal: 124, openNow: true,
    });
    const out = scorePlaces([unrated, rated], ctx({ mode: "walking" }));
    expect(out[0].id).toBe("google-500m");
    expect(out[0].reasons.some((r) => r.key === "highRated")).toBe(true);
  });

  it("still prefers a much closer unrated place when the rated one is a trip away", () => {
    const unrated = place({
      id: "osm-close", source: "overpass", name: "そば処",
      lat: 36.6494, lng: 138.1954, tags: ["food"], openNow: null,
    });
    const rated = place({
      id: "google-far", source: "google", name: "Far Bistro",
      lat: 36.6750, lng: 138.2100, tags: ["food"], rating: 4.5, userRatingsTotal: 124, openNow: true,
    });
    const out = scorePlaces([unrated, rated], ctx({ mode: "walking" }));
    expect(out[0].id).toBe("osm-close");
  });

  it("avoidCrowds reorders by the crowd rank inside the pool", () => {
    // Both at the same distance and unrated: only the crowd can separate them.
    // Levels are the realistic dense-city pair (0.93 / 1.00 saturated), which
    // is exactly why the ranking rescales onto the pool instead of comparing
    // against an absolute threshold.
    const quiet = place({ id: "quiet", name: "静食堂", lat: 36.6500, lng: 138.1955, tags: ["food"] });
    const busy = place({ id: "busy", name: "人気食堂", lat: 36.6500, lng: 138.1955, tags: ["food"] });
    const crowd = new Map([["quiet", { level: 0.93 }], ["busy", { level: 1.0 }]]);

    const off = scorePlaces([quiet, busy], ctx());
    const on = scorePlaces([quiet, busy], ctx({ avoidCrowds: true, crowd }));
    expect(on[0].id).toBe("quiet"); // quietest first, and it outranks its own no-flag score
    expect(on[0].score).toBeGreaterThan(off.find((p) => p.id === "quiet")!.score);
    expect(on[1].id).toBe("busy");
    // the label quotes the ABSOLUTE level: both are saturated here, so both
    // read "busy" even though the ranking put one ahead of the other
    for (const p of on) {
      expect(p.reasons.some((r) => ["crowdBusy", "crowdMild", "crowdQuiet"].includes(r.key))).toBe(true);
    }
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
    const boosted = scorePlaces([onsen], ctx({ profile: { onsen: 50 } }))[0];
    const neutral = scorePlaces([onsen], ctx())[0];
    // affinity is capped at +12, so a weight of 50 buys the same as 12
    const capped = scorePlaces([onsen], ctx({ profile: { onsen: 12 } }))[0];
    expect(boosted.score).toBe(capped.score);
    expect(boosted.score - neutral.score).toBe(12);
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

describe("scorePlaces — time-of-day context (destination-local wall clock)", () => {
  // 2026-08-15 is a Saturday; 2026-08-18 a Tuesday
  const satNoon = new Date(Date.UTC(2026, 7, 15, 12, 30));
  const goldenWeather = () =>
    weather({
      daily: [
        {
          date: "2026-08-15",
          code: 1,
          maxC: 28,
          minC: 20,
          precipProbMax: 10,
          sunrise: "2026-08-15T05:10",
          sunset: "2026-08-15T18:40",
        },
      ],
    });

  it("boosts food during meal windows only", () => {
    const lunch = scorePlaces([place({ tags: ["food"] })], ctx({ now: satNoon }))[0];
    expect(lunch.reasons.some((r) => r.key === "mealTime")).toBe(true);
    const mid = scorePlaces(
      [place({ tags: ["food"] })],
      ctx({ now: new Date(Date.UTC(2026, 7, 15, 16, 0)) })
    )[0];
    expect(mid.reasons.some((r) => r.key === "mealTime")).toBe(false);
  });

  it("boosts nightlife at night", () => {
    const night = scorePlaces(
      [place({ tags: ["nightlife"] })],
      ctx({ now: new Date(Date.UTC(2026, 7, 18, 22, 0)) })
    )[0];
    expect(night.reasons.some((r) => r.key === "nightTime")).toBe(true);
    const day = scorePlaces([place({ tags: ["nightlife"] })], ctx({ now: satNoon }))[0];
    expect(day.reasons.some((r) => r.key === "nightTime")).toBe(false);
  });

  it("boosts onsen in the evening", () => {
    const eve = scorePlaces(
      [place({ tags: ["onsen"] })],
      ctx({ now: new Date(Date.UTC(2026, 7, 18, 19, 0)) })
    )[0];
    expect(eve.reasons.some((r) => r.key === "onsenEvening")).toBe(true);
  });

  it("boosts viewpoints in golden hour using real sunrise/sunset", () => {
    const atSunset = new Date(Date.UTC(2026, 7, 15, 18, 10)); // 30 min before sunset
    const vp = scorePlaces(
      [place({ tags: ["viewpoint"] })],
      ctx({ weather: goldenWeather(), now: atSunset })
    )[0];
    expect(vp.reasons.some((r) => r.key === "goldenHour")).toBe(true);
    const noon = scorePlaces(
      [place({ tags: ["viewpoint"] })],
      ctx({ weather: goldenWeather(), now: satNoon })
    )[0];
    expect(noon.reasons.some((r) => r.key === "goldenHour")).toBe(false);
  });

  it("boosts parks/markets on weekends only", () => {
    const sat = scorePlaces([place({ tags: ["park"] })], ctx({ now: satNoon }))[0];
    expect(sat.reasons.some((r) => r.key === "weekend")).toBe(true);
    const tue = scorePlaces(
      [place({ tags: ["park"] })],
      ctx({ now: new Date(Date.UTC(2026, 7, 18, 12, 0)) })
    )[0];
    expect(tue.reasons.some((r) => r.key === "weekend")).toBe(false);
  });

  it("boosts Wikipedia-documented landmarks, except when the keyword hit", () => {
    const plain = scorePlaces(
      [place({ tags: ["temple"], wikipedia: "ja:善光寺" })],
      ctx()
    )[0];
    expect(plain.reasons.some((r) => r.key === "landmark")).toBe(true);
    const kw = scorePlaces(
      [place({ name: "善光寺", tags: ["temple"], wikipedia: "ja:善光寺" })],
      ctx({ keyword: "善光寺", keywordTerms: ["善光寺"] })
    )[0];
    expect(kw.reasons.some((r) => r.key === "keywordMatch")).toBe(true);
    expect(kw.reasons.some((r) => r.key === "landmark")).toBe(false);
  });
});

describe("scorePlaces — pinned exemptions", () => {
  it("keeps a pinned place even when closed or beyond the filters", () => {
    const closed = place({ id: "pin1", openNow: false });
    const far = place({ id: "pin2", lat: 36.9, lng: 138.5 }); // ~40 km
    const out = scorePlaces(
      [closed, far],
      ctx({ maxDistKm: 1, pinnedIds: new Set(["pin1", "pin2"]) })
    );
    expect(out.map((p) => p.id)).toEqual(["pin1", "pin2"]);
  });

  it("drops the same places when they are not pinned", () => {
    const closed = place({ openNow: false });
    const far = place({ lat: 36.9, lng: 138.5 });
    const out = scorePlaces([closed, far], ctx({ maxDistKm: 1 }));
    expect(out).toHaveLength(0);
  });
});
