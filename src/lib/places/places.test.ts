import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { googleSearch } from "@/lib/places/google";
import { geoapifySearch } from "@/lib/places/geoapify";
import { overpassSearch, MIRRORS } from "@/lib/places/overpass";
import { discover } from "@/lib/places";
import { resolveTypes } from "@/lib/places/taxonomy";
import { upsertPlace, setAdminForTests } from "@/lib/cache";
import { mockFetch, jsonResponse, urlContains, isolatedStore } from "@/test-utils/helpers";
import { makeSupabaseFake } from "@/test-utils/supabase-fake";

const KEY = "AIza-test";

const googleResult = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  place_id: id,
  name,
  geometry: { location: { lat: 36.65, lng: 138.19 } },
  rating: 4.3,
  user_ratings_total: 120,
  photos: [
    { photo_reference: "ref-a" },
    { photo_reference: "ref-b" },
    { photo_reference: "ref-c" },
  ],
  ...over,
});

describe("googleSearch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses results with rating, reviews and up to 5 photos", async () => {
    mockFetch([
      {
        match: urlContains("textsearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [googleResult("p1", "Templo A", { photos: [{ photo_reference: "r1" }, { photo_reference: "r2" }] })],
          }),
      },
      {
        match: urlContains("nearbysearch"),
        response: () => jsonResponse({ status: "OK", results: [googleResult("p1", "Templo A")] }),
      },
    ]);
    const places = await googleSearch(KEY, resolveTypes(["temple"])[0], 36.65, 138.19, 5000, "es");
    expect(places).toHaveLength(1); // deduped by place_id
    expect(places[0].userRatingsTotal).toBe(120);
    expect(places[0].photoRefs).toEqual(["r1", "r2"]);
    expect(places[0].tags).toEqual(["temple"]);
  });

  it("asks for strictbounds and never sends opennow (we filter closed places in scoring)", async () => {
    const urls: string[] = [];
    mockFetch([
      {
        match: (u) => u.includes("textsearch") || u.includes("nearbysearch"),
        response: (u) => {
          urls.push(u);
          return jsonResponse({ status: "ZERO_RESULTS", results: [] });
        },
      },
    ]);
    await googleSearch(KEY, resolveTypes(["museum"])[0], 36.65, 138.19, 5000, "es");
    expect(urls.length).toBe(2); // text + nearby
    expect(urls.some((u) => u.includes("strictbounds=true"))).toBe(true);
    expect(urls.some((u) => u.includes("opennow=true"))).toBe(false);
  });

  it("keeps all candidates in real mode too (closed places are filtered later)", async () => {
    const urls: string[] = [];
    mockFetch([
      {
        match: (u) => u.includes("textsearch") || u.includes("nearbysearch"),
        response: (u) => {
          urls.push(u);
          return jsonResponse({
            status: "OK",
            results: [
              googleResult("open", "Abierto", { opening_hours: { open_now: true } }),
              googleResult("closed", "Cerrado", { opening_hours: { open_now: false } }),
              googleResult("nohours", "Sin horario", {}),
            ],
          });
        },
      },
    ]);
    const places = await googleSearch(KEY, resolveTypes(["museum"])[0], 36.65, 138.19, 5000, "es");
    expect(places).toHaveLength(3);
    expect(places.map((p) => p.openNow)).toEqual([true, false, null]);
  });

  it("filters out closed businesses", async () => {
    mockFetch([
      {
        match: urlContains("textsearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              googleResult("open", "Abierto", { business_status: "OPERATIONAL" }),
              googleResult("closed", "Cerrado", { business_status: "CLOSED_PERMANENTLY" }),
            ],
          }),
      },
      {
        match: urlContains("nearbysearch"),
        response: () => jsonResponse({ status: "OK", results: [] }),
      },
    ]);
    const places = await googleSearch(KEY, resolveTypes(["food"])[0], 36.65, 138.19, 5000, "es");
    expect(places.map((p) => p.id)).toEqual(["g_open"]);
  });

  it("paginates nearby search via next_page_token", async () => {
    const urls: string[] = [];
    mockFetch([
      {
        match: urlContains("textsearch"),
        response: () => jsonResponse({ status: "ZERO_RESULTS", results: [] }),
      },
      {
        match: (u) => u.includes("nearbysearch") && !u.includes("pagetoken"),
        response: (u) => {
          urls.push(u);
          return jsonResponse({
            status: "OK",
            results: [googleResult("p1", "Place A")],
            next_page_token: "tok1",
          });
        },
      },
      {
        match: (u) => u.includes("nearbysearch") && u.includes("pagetoken=tok1"),
        response: (u) => {
          urls.push(u);
          return jsonResponse({ status: "OK", results: [googleResult("p2", "Place B")] });
        },
      },
    ]);
    const places = await googleSearch(KEY, resolveTypes(["museum"])[0], 36.65, 138.19, 5000, "es");
    expect(places.map((p) => p.id)).toEqual(["g_p1", "g_p2"]);
    expect(urls.some((u) => u.includes("pagetoken=tok1"))).toBe(true);
  });

  it("queries every mapped google type, not just the first (food → restaurant + food)", async () => {
    const urls: string[] = [];
    mockFetch([
      {
        match: (u) => u.includes("textsearch") || u.includes("nearbysearch"),
        response: (u) => {
          urls.push(u);
          return jsonResponse({ status: "OK", results: [] });
        },
      },
    ]);
    await googleSearch(KEY, resolveTypes(["food"])[0], 36.65, 138.19, 5000, "es");
    const nearby = urls.filter((u) => u.includes("nearbysearch"));
    expect(nearby).toHaveLength(2);
    expect(nearby.some((u) => u.includes("type=restaurant"))).toBe(true);
    expect(nearby.some((u) => u.includes("type=food"))).toBe(true);
  });

  it("drops hotels (lodging) from food results but keeps ryokan-onsen", async () => {
    mockFetch([
      {
        match: urlContains("textsearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              googleResult("hotel", "Marunouchi Hotel Pomme", { types: ["lodging", "restaurant", "cafe"] }),
              googleResult("ramen", "Ramen Ichiban", { types: ["restaurant"] }),
            ],
          }),
      },
      {
        match: urlContains("nearbysearch"),
        response: () => jsonResponse({ status: "ZERO_RESULTS", results: [] }),
      },
    ]);
    const food = await googleSearch(KEY, resolveTypes(["food"])[0], 36.65, 138.19, 5000, "es");
    expect(food.map((p) => p.id)).toEqual(["g_ramen"]);

    // onsen keeps hotels with spa (ryokan)
    mockFetch([
      {
        match: urlContains("textsearch"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [googleResult("ryokan", "Ryokan Sanga", { types: ["lodging", "spa"] })],
          }),
      },
      {
        match: urlContains("nearbysearch"),
        response: () => jsonResponse({ status: "ZERO_RESULTS", results: [] }),
      },
    ]);
    const onsen = await googleSearch(KEY, resolveTypes(["onsen"])[0], 36.65, 138.19, 5000, "es");
    expect(onsen.map((p) => p.id)).toEqual(["g_ryokan"]);
  });

  it("uses the interest keyword as the text-search query", async () => {
    let urls: string[] = [];
    mockFetch([
      {
        match: urlContains("textsearch"),
        response: (u) => {
          urls.push(u);
          return jsonResponse({ status: "ZERO_RESULTS", results: [] });
        },
      },
      {
        match: urlContains("nearbysearch"),
        response: () => jsonResponse({ status: "ZERO_RESULTS", results: [] }),
      },
    ]);
    await googleSearch(KEY, resolveTypes(["museum"])[0], 36.65, 138.19, 5000, "es", "pokemon");
    expect(urls.length).toBe(1);
    expect(urls[0]).toContain("query=pokemon+near");
    // without keyword the type query is used
    mockFetch([
      {
        match: urlContains("textsearch"),
        response: (u) => {
          urls = [u];
          return jsonResponse({ status: "ZERO_RESULTS", results: [] });
        },
      },
      {
        match: urlContains("nearbysearch"),
        response: () => jsonResponse({ status: "ZERO_RESULTS", results: [] }),
      },
    ]);
    await googleSearch(KEY, resolveTypes(["museum"])[0], 36.65, 138.19, 5000, "es");
    expect(urls[0]).toContain("query=museum+near");
  });
});

describe("geoapifySearch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses features and skips unmapped types", async () => {
    mockFetch([
      {
        match: urlContains("api.geoapify.com/v2/places"),
        response: () =>
          jsonResponse({
            features: [
              {
                properties: { name: "Café X", address_line1: "Calle 1" },
                geometry: { coordinates: [138.19, 36.65] },
              },
            ],
          }),
      },
    ]);
    const places = await geoapifySearch("geo-key", resolveTypes(["food"]), 36.65, 138.19, 5000, "es");
    expect(places).toHaveLength(1);
    expect(places[0].source).toBe("geoapify");
    // trekking has no geoapify mapping → no request, empty result
    const trekking = await geoapifySearch("geo-key", resolveTypes(["trekking"]), 36.65, 138.19, 5000, "es");
    expect(trekking).toHaveLength(0);
  });
});

describe("overpassSearch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("assigns types by tag match and falls back to a generic name", async () => {
    mockFetch([
      {
        match: urlContains("interpreter"),
        response: () =>
          jsonResponse({
            elements: [
              { type: "node", id: 1, lat: 36.65, lon: 138.19, tags: { leisure: "hot_spring", name: "Kame no Yu" } },
              { type: "node", id: 2, lat: 36.66, lon: 138.2, tags: { tourism: "viewpoint" } },
              { type: "way", id: 3, center: { lat: 36.67, lon: 138.21 }, tags: { leisure: "park" } },
            ],
          }),
      },
    ]);
    const places = await overpassSearch(resolveTypes(["onsen", "viewpoint", "park"]), 36.65, 138.19, 5000);
    expect(places.find((p) => p.id === "o_node_1")?.name).toBe("Kame no Yu");
    expect(places.find((p) => p.id === "o_node_1")?.tags).toEqual(["onsen"]);
    expect(places.find((p) => p.id === "o_node_2")?.tags).toEqual(["viewpoint"]);
    expect(places.find((p) => p.id === "o_way_3")?.tags).toEqual(["park"]);
    expect(places.find((p) => p.id === "o_node_2")?.name).toContain("Mirador"); // fallback name
  });

  it("sends a single combined query with every tag spec and per-type output caps", async () => {
    const fn = mockFetch([
      {
        match: urlContains("interpreter"),
        response: () => jsonResponse({ elements: [] }),
      },
    ]);
    await overpassSearch(resolveTypes(["onsen", "temple"]), 36.65, 138.19, 5000);
    // one combined query per mirror; an empty mirror no longer short-circuits
    // the failover (osm.ch is thin for Asia — later mirrors may have data)
    expect(fn).toHaveBeenCalledTimes(MIRRORS.length);
    const called = fn.mock.calls[0];
    const sent = decodeURIComponent(String(called[1]?.body ?? "")).replace(/\+/g, " ");
    expect(sent).toContain('leisure="hot_spring"');
    expect(sent).toContain('name~"温泉"');
    expect(sent).toContain('historic="temple"');
    // per-type named sets + independent out caps: one type's volume cannot
    // starve the other (a global `out center 120` would)
    expect(sent).toContain("->.t0;.t0 out center 250;");
    expect(sent).toContain("->.t1;.t1 out center 250;");
  });
});

describe("discover — merged multi-source chain", () => {
  let sb: ReturnType<typeof makeSupabaseFake>;

  // Overpass now runs in parallel with Google/Geoapify — tests that don't
  // assert Overpass behavior mock it as "no elements" (fast, deterministic);
  // without this, the mirror retry backoff burns the whole supplementary
  // budget (~12 s of sleeps) per discover call.
  const overpassEmpty = () => ({
    match: urlContains("interpreter"),
    response: () => jsonResponse({ elements: [] }),
  });

  beforeEach(() => {
    isolatedStore();
    // discover() reads/writes the shared cache via Supabase — install an
    // in-memory fake (one per test) so cache checks are deterministic and no
    // real client is ever constructed in unit tests.
    sb = makeSupabaseFake();
    setAdminForTests(() => sb.fake as never);
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    process.env.GEOAPIFY_API_KEY = "geo-key";
  });
  afterEach(() => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GEOAPIFY_API_KEY;
    vi.unstubAllGlobals();
  });

  it("uses google when it returns places", async () => {
    mockFetch([
      overpassEmpty(),
      {
        match: urlContains("googleapis.com"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              { place_id: "x1", name: "Parque", geometry: { location: { lat: 36.65, lng: 138.19 } } },
            ],
          }),
      },
    ]);
    const { places, source, sources } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    expect(source).toBe("google");
    expect(sources).toEqual(["google"]);
    expect(places).toHaveLength(1);
  });

  it("drops world-famous places that text search leaks beyond the radius", async () => {
    mockFetch([
      overpassEmpty(),
      {
        match: urlContains("googleapis.com"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              // local (within 5km)
              { place_id: "local1", name: "Parque Local", geometry: { location: { lat: 36.65, lng: 138.19 } } },
              // San Diego (≈9,000 km away) — must never become a candidate
              { place_id: "far1", name: "San Diego View Point", geometry: { location: { lat: 32.71, lng: -117.16 } } },
            ],
          }),
      },
    ]);
    const { places } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    expect(places.map((p) => p.id)).toEqual(["g_local1"]);
  });

  it("falls back to geoapify when google fails", async () => {
    mockFetch([
      overpassEmpty(),
      { match: urlContains("googleapis.com"), response: () => jsonResponse({}, 500) },
      {
        match: urlContains("api.geoapify.com"),
        response: () =>
          jsonResponse({
            features: [
              { properties: { name: "Geo Café" }, geometry: { coordinates: [138.19, 36.65] } },
            ],
          }),
      },
    ]);
    const { places, source } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["food"] });
    expect(source).toBe("geoapify");
    expect(places[0].name).toBe("Geo Café");
  });

  it("falls back to overpass when google and geoapify fail", async () => {
    mockFetch([
      { match: urlContains("googleapis.com"), response: () => jsonResponse({}, 500) },
      { match: urlContains("api.geoapify.com"), response: () => jsonResponse({}, 500) },
      {
        match: urlContains("interpreter"),
        response: () =>
          jsonResponse({
            elements: [{ type: "node", id: 9, lat: 36.65, lon: 138.19, tags: { leisure: "park" } }],
          }),
      },
    ]);
    const { places, source, sources } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    expect(source).toBe("overpass");
    expect(sources).toEqual(["overpass"]);
    expect(places).toHaveLength(1);
  });

  it("serves the local cache when everything fails and it covers the types", async () => {
    await upsertPlace({
      id: "c1", source: "google", name: "Cached Park", lat: 36.65, lng: 138.19,
      tags: ["park"], openNow: null,
    });
    mockFetch([overpassEmpty(), { match: () => true, response: () => jsonResponse({}, 500) }]);
    const { places, source } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    expect(source).toBe("cache");
    expect(places[0].name).toBe("Cached Park");
  });

  it("returns whatever cache matches when live sources fail and coverage is partial", async () => {
    await upsertPlace({
      id: "c1", source: "google", name: "Cached Park", lat: 36.65, lng: 138.19,
      tags: ["park"], openNow: null,
    });
    mockFetch([overpassEmpty(), { match: () => true, response: () => jsonResponse({}, 500) }]);
    const { places, source } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park", "museum"] });
    expect(source).toBe("cache");
    expect(places.map((p) => p.tags)).toEqual([["park"]]);
  });

  it("merges google + overpass in parallel (no more first-source-wins)", async () => {
    mockFetch([
      {
        match: urlContains("googleapis.com"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              { place_id: "g1", name: "Parque Central", geometry: { location: { lat: 36.65, lng: 138.19 } }, rating: 4.5 },
              { place_id: "g2", name: "Jardín Este", geometry: { location: { lat: 36.66, lng: 138.2 } }, rating: 4.2 },
            ],
          }),
      },
      {
        match: urlContains("interpreter"),
        response: () =>
          jsonResponse({
            elements: [
              { type: "node", id: 1, lat: 36.651, lon: 138.191, tags: { leisure: "park" } },
              { type: "way", id: 2, center: { lat: 36.7, lon: 138.23 }, tags: { leisure: "park" } },
            ],
          }),
      },
    ]);
    const { places, source, sources } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    // both OSM spots survive: the node is ~120m from g1 (outside the 60m
    // proximity window) and the way is farther — google dominates by count
    expect(source).toBe("google");
    expect(sources).toEqual(["google", "overpass"]);
    expect(places.length).toBe(4);
  });

  it("skips overpass entirely for keyword searches when a google key answered", async () => {
    const fn = mockFetch([
      {
        match: urlContains("googleapis.com"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              { place_id: "k1", name: "Neko Café Naru", geometry: { location: { lat: 36.65, lng: 138.19 } }, rating: 4.8 },
            ],
          }),
      },
      {
        match: urlContains("interpreter"),
        response: () => jsonResponse({ elements: [{ type: "node", id: 1, lat: 36.65, lon: 138.19, tags: { tourism: "attraction" } }] }),
      },
    ]);
    const { sources } = await discover({
      lat: 36.65, lng: 138.19, radiusKm: 5, types: ["food"],
      keyword: "gatos",
    });
    expect(sources).toEqual(["google"]); // overpass results discarded
    const interpreterCalls = fn.mock.calls.filter((c) => String(c[0]).includes("interpreter"));
    expect(interpreterCalls).toHaveLength(0); // and never even started
  });

  it("drops a real OSM duplicate (same name) next to a rated google place", async () => {
    mockFetch([
      {
        match: urlContains("googleapis.com"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              { place_id: "g1", name: "Koen Park", geometry: { location: { lat: 36.65, lng: 138.19 } }, rating: 4.5 },
            ],
          }),
      },
      {
        match: urlContains("interpreter"),
        response: () =>
          jsonResponse({
            elements: [
              { type: "node", id: 77, lat: 36.6502, lon: 138.1902, tags: { leisure: "park", name: "koen park" } },
            ],
          }),
      },
    ]);
    const { places, sources } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    expect(places.map((p) => p.id)).toEqual(["g_g1"]);
    expect(sources).toEqual(["google"]);
  });

  it("drops a nameless OSM node (fallback name) beside the rated entry", async () => {
    mockFetch([
      {
        match: urlContains("googleapis.com"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              { place_id: "g1", name: "Koen Park", geometry: { location: { lat: 36.65, lng: 138.19 } }, rating: 4.5 },
            ],
          }),
      },
      {
        match: urlContains("interpreter"),
        response: () =>
          jsonResponse({
            elements: [
              { type: "node", id: 77, lat: 36.6502, lon: 138.1902, tags: { leisure: "park" } },
            ],
          }),
      },
    ]);
    const { places, sources } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    expect(places.map((p) => p.id)).toEqual(["g_g1"]);
    expect(sources).toEqual(["google"]);
  });

  it("keeps a differently-named place of the same type next to a rated one (dense cluster)", async () => {
    mockFetch([
      {
        match: urlContains("googleapis.com"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              { place_id: "g1", name: "Ramen Ichiban", geometry: { location: { lat: 36.65, lng: 138.19 } }, rating: 4.3 },
            ],
          }),
      },
      {
        match: urlContains("interpreter"),
        response: () =>
          jsonResponse({
            elements: [
              // ~28 m away but a DIFFERENT restaurant — must survive the merge
              { type: "node", id: 88, lat: 36.6502, lon: 138.1902, tags: { amenity: "restaurant", name: "ラーメン山" } },
            ],
          }),
      },
    ]);
    const { places, sources } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["food"] });
    expect(places.map((p) => p.id).sort()).toEqual(["g_g1", "o_node_88"]);
    expect(sources).toEqual(["google", "overpass"]);
  });

  it("keeps a different-type place next to a rated one (park beside a restaurant)", async () => {
    mockFetch([
      {
        match: urlContains("googleapis.com"),
        response: () =>
          jsonResponse({
            status: "OK",
            results: [
              { place_id: "g1", name: "Ramen Ichiban", geometry: { location: { lat: 36.65, lng: 138.19 } }, rating: 4.3 },
            ],
          }),
      },
      {
        match: urlContains("interpreter"),
        response: () =>
          jsonResponse({
            elements: [
              { type: "node", id: 88, lat: 36.6504, lon: 138.1904, tags: { leisure: "park" } },
            ],
          }),
      },
    ]);
    const { places, sources } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["food", "park"] });
    expect(places.map((p) => p.id).sort()).toEqual(["g_g1", "o_node_88"]);
    expect(sources).toEqual(["google", "overpass"]);
  });

  it("keeps the whole merged pool (no small cap) up to POOL_CAP", async () => {
    const results = Array.from({ length: 25 }, (_, i) => ({
      place_id: `g${i}`,
      name: `Lugar ${i}`,
      geometry: { location: { lat: 36.65 + i * 0.001, lng: 138.19 } },
      rating: 4.0,
    }));
    mockFetch([
      {
        match: urlContains("googleapis.com"),
        response: () => jsonResponse({ status: "OK", results }),
      },
      {
        match: urlContains("interpreter"),
        response: () =>
          jsonResponse({
            elements: Array.from({ length: 25 }, (_, i) => ({
              type: "node" as const,
              id: 100 + i,
              lat: 36.65 + i * 0.001,
              lon: 138.19 + 0.001,
              tags: { leisure: "park" },
            })),
          }),
      },
    ]);
    const { places, sources } = await discover({ lat: 36.65, lng: 138.19, radiusKm: 5, types: ["park"] });
    expect(places.length).toBe(50);
    expect(sources).toEqual(["google", "overpass"]);
  });
});
