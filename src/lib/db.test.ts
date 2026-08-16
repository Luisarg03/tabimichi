import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import {
  upsertPlace,
  placeById,
  cachePlaces,
  freshNearby,
  applyFeedback,
  getProfile,
  resetProfile,
  setProfileWeight,
  setDataDir,
} from "@/lib/db";
import { isolatedStore } from "@/test-utils/helpers";

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

describe("places store", () => {
  beforeEach(() => isolatedStore());

  it("round-trips upsert → placeById", () => {
    upsertPlace(p("a1", { rating: 4.2, userRatingsTotal: 300, photoRefs: ["r1", "r2"], tags: ["onsen"] }));
    const back = placeById("a1");
    expect(back?.name).toBe("Place a1");
    expect(back?.rating).toBe(4.2);
    expect(back?.userRatingsTotal).toBe(300);
    expect(back?.photoRefs).toEqual(["r1", "r2"]);
    expect(back?.photoRef).toBe("r1");
    expect(back?.tags).toEqual(["onsen"]);
  });

  it("freshNearby returns only when every type is covered", () => {
    cachePlaces([p("x1", { tags: ["park"] }), p("x2", { tags: ["museum"] })]);
    const all = freshNearby(36.65, 138.19, 5, ["park", "museum"], 60_000);
    expect(all).not.toBeNull();
    const missing = freshNearby(36.65, 138.19, 5, ["park", "onsen"], 60_000);
    expect(missing).toBeNull();
  });

  it("freshNearby ignores stale rows", () => {
    cachePlaces([p("old1", { tags: ["park"] })]);
    const d = new DatabaseSync(path.join(process.env.TABI_DATA_DIR!, "tabi.db"));
    d.prepare("UPDATE places SET fetched_at = ? WHERE id = 'old1'").run(
      new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    );
    d.close();
    expect(freshNearby(36.65, 138.19, 5, ["park"], 60_000)).toBeNull();
  });
});

describe("feedback → profile", () => {
  beforeEach(() => isolatedStore());

  it("accumulates likes and dislikes per tag", () => {
    upsertPlace(p("f1", { tags: ["onsen", "food"] }));
    applyFeedback("f1", true, ["onsen", "food"]);
    applyFeedback("f1", true, ["onsen"]);
    const profile = getProfile();
    expect(profile.onsen).toBe(2);
    expect(profile.food).toBe(1);
  });

  it("uses the tags sent from the card over cached tags", () => {
    upsertPlace(p("f2", { tags: ["park"] }));
    applyFeedback("f2", true, ["onsen"]); // card said onsen
    expect(getProfile().onsen).toBe(1);
    expect(getProfile().park).toBeUndefined();
  });

  it("clamps weights to ±5", () => {
    upsertPlace(p("f3", { tags: ["onsen"] }));
    for (let i = 0; i < 7; i++) applyFeedback("f3", true, ["onsen"]);
    expect(getProfile().onsen).toBe(5);
    for (let i = 0; i < 10; i++) applyFeedback("f3", false, ["onsen"]);
    expect(getProfile().onsen).toBe(-5);
  });

  it("setProfileWeight sets, clamps and removes at zero", () => {
    setProfileWeight("onsen", 3);
    expect(getProfile().onsen).toBe(3);
    setProfileWeight("onsen", 99);
    expect(getProfile().onsen).toBe(5);
    setProfileWeight("onsen", -99);
    expect(getProfile().onsen).toBe(-5);
    setProfileWeight("onsen", 0);
    expect(getProfile().onsen).toBeUndefined();
  });

  it("resetProfile clears everything", () => {
    setProfileWeight("onsen", 2);
    setProfileWeight("food", -1);
    expect(Object.keys(resetProfile())).toHaveLength(0);
    expect(getProfile()).toEqual({});
  });
});
