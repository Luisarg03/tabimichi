import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertPlace,
  cachePlaces,
  placeById,
  cachedNear,
  freshNearby,
  discoveryDone,
  markDiscoveryDone,
  photosVerified,
  setPhotosVerified,
  readCachedPhoto,
  writeCachedPhoto,
  setAdminForTests,
  EMPTY_AREA_TTL_MS,
} from "@/lib/cache";
import { makeSupabaseFake } from "@/test-utils/supabase-fake";

const p = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  source: "google" as const,
  name: `Place ${id}`,
  lat: 36.65,
  lng: 138.19,
  tags: ["park"],
  openNow: null,
  ...over,
});

describe("place cache (Supabase)", () => {
  let sb: ReturnType<typeof makeSupabaseFake>;

  beforeEach(() => {
    sb = makeSupabaseFake();
    setAdminForTests(() => sb.fake as never);
  });

  it("round-trips upsert → placeById", async () => {
    await upsertPlace(
      p("a1", { rating: 4.2, userRatingsTotal: 300, photoRefs: ["r1", "r2"], tags: ["onsen"], wikipedia: "ja:渋温泉" })
    );
    const back = await placeById("a1");
    expect(back?.name).toBe("Place a1");
    expect(back?.rating).toBe(4.2);
    expect(back?.userRatingsTotal).toBe(300);
    expect(back?.photoRefs).toEqual(["r1", "r2"]);
    expect(back?.photoRef).toBe("r1");
    expect(back?.tags).toEqual(["onsen"]);
    expect(back?.wikipedia).toBe("ja:渋温泉");
  });

  it("treats a stale cached open_now as unknown (it is a point-in-time snapshot)", async () => {
    await upsertPlace(p("x1", { openNow: false }));
    expect((await placeById("x1"))?.openNow).toBe(false); // fresh → honored
    sb.places.get("x1")!.fetched_at = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    expect((await placeById("x1"))?.openNow).toBeUndefined(); // stale → unknown
  });

  it("freshNearby returns only when every type is covered", async () => {
    await cachePlaces([p("x1", { tags: ["park"] }), p("x2", { tags: ["museum"] })]);
    const all = await freshNearby(36.65, 138.19, 5, ["park", "museum"], 60_000);
    expect(all.status).toBe("found");
    // partial coverage is a MISS, never "empty": nothing was concluded about
    // the missing type, so discovery still has to go live
    const missing = await freshNearby(36.65, 138.19, 5, ["park", "onsen"], 60_000);
    expect(missing.status).toBe("miss");
  });

  it("freshNearby ignores stale rows", async () => {
    await cachePlaces([p("old1", { tags: ["park"] })]);
    const row = sb.places.get("old1")!;
    row.fetched_at = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    expect((await freshNearby(36.65, 138.19, 5, ["park"], 60_000)).status).toBe("miss");
  });

  it("cachedNear returns newest first within the bounding box", async () => {
    await cachePlaces([
      p("far", { lat: 36.66, lng: 138.2 }),
      p("near", { lat: 36.651, lng: 138.191 }),
    ]);
    sb.places.get("far")!.fetched_at = "2026-01-01T00:00:00.000Z";
    const rows = await cachedNear(36.65, 138.19, 5);
    expect(rows[0]?.id).toBe("near");
  });

  it("photos_verified flag gates re-enrichment", async () => {
    await upsertPlace(p("v1"));
    expect(await photosVerified("v1")).toBe(false);
    await setPhotosVerified("v1", true);
    expect(await photosVerified("v1")).toBe(true);
  });

  it("bulk upsert tolerates duplicate ids (text + nearby can overlap)", async () => {
    await cachePlaces([p("dup", { name: "Variante A" }), p("dup", { name: "Variante B" })]);
    expect(sb.places.size).toBe(1);
    expect((await placeById("dup"))?.name).toBe("Variante B"); // last wins
  });

  it("degrades to a miss when the store errors", async () => {
    setAdminForTests(() => {
      throw new Error("boom");
    });
    expect(await placeById("nope")).toBeNull();
    // a broken store is a MISS, never "empty" — the caller must not report a
    // keyword as matching nothing when nobody managed to ask
    expect((await freshNearby(36.65, 138.19, 5, ["park"], 60_000)).status).toBe("miss");
    expect((await freshNearby(36.65, 138.19, 5, ["park"], 60_000, "gatos")).status).toBe("miss");
  });

  it("keeps working when migration 008 has not been applied yet", async () => {
    // A database without from_keyword/keyword_key: selecting either column
    // fails the WHOLE read, so the cache must fall back to select("*") instead
    // of turning every discovery into a failed query.
    const rows: Record<string, unknown>[] = [
      {
        id: "legacy1", source: "google", name: "Legacy Park", lat: 36.65, lng: 138.19,
        tags: JSON.stringify(["park"]), fetched_at: new Date().toISOString(),
      },
    ];
    const missing = (col: string) => ({
      message: `column place_cache.${col} does not exist`,
    });
    setAdminForTests(
      () =>
        ({
          from: () => ({
            select: (cols: string) => {
              const api = {
                not: () => api,
                gte: () => api,
                lte: () => api,
                eq: () => api,
                order: () => api,
                limit: () => api,
                maybeSingle: async () => ({ data: null, error: null }),
                then: (resolve: (v: unknown) => void) =>
                  resolve(
                    cols.includes("from_keyword")
                      ? { data: null, error: missing("from_keyword") }
                      : { data: rows, error: null }
                  ),
              };
              return api;
            },
          }),
        }) as never
    );

    const generic = await freshNearby(36.65, 138.19, 5, ["park"], 60_000);
    expect(generic.status).toBe("found");
    expect(generic.status === "found" && generic.places[0].id).toBe("legacy1");
    // the keyword path must survive the same way (it selects the columns too)
    const keyword = await freshNearby(36.65, 138.19, 5, ["park"], 60_000, "gatos");
    expect(keyword.status).not.toBe("empty");
  });
});

describe("discovery markers (negative cache)", () => {
  let sb: ReturnType<typeof makeSupabaseFake>;

  beforeEach(() => {
    sb = makeSupabaseFake();
    setAdminForTests(() => sb.fake as never);
  });

  it("records a conclusive empty area and honors it only within its TTL", async () => {
    expect(await discoveryDone(36.65, 138.19, ["park"], undefined)).toBe(false);
    await markDiscoveryDone(36.65, 138.19, ["park"], undefined);
    expect(await discoveryDone(36.65, 138.19, ["park"], undefined)).toBe(true);
    // a different signature is a different question
    expect(await discoveryDone(36.65, 138.19, ["onsen"], undefined)).toBe(false);
    expect(await discoveryDone(35.0, 138.19, ["park"], undefined)).toBe(false);

    // past the area TTL the marker stops answering, so an area is retried
    const marker = [...sb.places.values()].find((r) => String(r.id).startsWith("__done__:"))!;
    marker.fetched_at = new Date(Date.now() - (EMPTY_AREA_TTL_MS + 60_000)).toISOString();
    expect(await discoveryDone(36.65, 138.19, ["park"], undefined)).toBe(false);
  });

  it("keys keyword markers by keyword and keeps the longer TTL", async () => {
    await markDiscoveryDone(36.65, 138.19, ["food"], "gatos");
    expect(await discoveryDone(36.65, 138.19, ["food"], "gatos")).toBe(true);
    expect(await discoveryDone(36.65, 138.19, ["food"], "pokemon")).toBe(false);
    // keyword TTL outlives the area TTL
    const marker = [...sb.places.values()].find((r) => String(r.id).startsWith("__done__:"))!;
    marker.fetched_at = new Date(Date.now() - (EMPTY_AREA_TTL_MS + 60_000)).toISOString();
    expect(await discoveryDone(36.65, 138.19, ["food"], "gatos")).toBe(true);
  });

  it("never serves a marker as a place", async () => {
    await markDiscoveryDone(36.65, 138.19, ["park"], undefined);
    expect(await cachedNear(36.65, 138.19, 5)).toEqual([]);
    // and a pool read never reports the marker area as covered
    expect((await freshNearby(36.65, 138.19, 5, ["park"], 60_000)).status).toBe("miss");
  });
});

describe("photo cache (Supabase Storage)", () => {
  let sb: ReturnType<typeof makeSupabaseFake>;

  beforeEach(() => {
    sb = makeSupabaseFake();
    setAdminForTests(() => sb.fake as never);
  });

  it("round-trips write → read", async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    await writeCachedPhoto("g_p1", "refA", bytes);
    const back = await readCachedPhoto("g_p1", "refA");
    expect(back).toEqual(bytes);
    expect(await readCachedPhoto("g_p1", "otherRef")).toBeNull();
    expect(sb.storage.size).toBe(1);
  });

  it("overwrites the same key on re-write", async () => {
    await writeCachedPhoto("g_p1", "refA", Buffer.from([1]));
    await writeCachedPhoto("g_p1", "refA", Buffer.from([9, 9]));
    expect(await readCachedPhoto("g_p1", "refA")).toEqual(Buffer.from([9, 9]));
  });
});
