import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertPlace,
  cachePlaces,
  placeById,
  cachedNear,
  freshNearby,
  photosVerified,
  setPhotosVerified,
  readCachedPhoto,
  writeCachedPhoto,
  setAdminForTests,
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
    expect(all).not.toBeNull();
    const missing = await freshNearby(36.65, 138.19, 5, ["park", "onsen"], 60_000);
    expect(missing).toBeNull();
  });

  it("freshNearby ignores stale rows", async () => {
    await cachePlaces([p("old1", { tags: ["park"] })]);
    const row = sb.places.get("old1")!;
    row.fetched_at = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    expect(await freshNearby(36.65, 138.19, 5, ["park"], 60_000)).toBeNull();
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
    expect(await freshNearby(36.65, 138.19, 5, ["park"], 60_000)).toBeNull();
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
