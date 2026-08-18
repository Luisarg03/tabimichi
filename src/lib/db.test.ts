import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyFeedback, getProfile, resetProfile, setProfileWeight, setDataDir } from "@/lib/db";
import { upsertPlace, setAdminForTests } from "@/lib/cache";
import { isolatedStore } from "@/test-utils/helpers";
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

describe("feedback → profile", () => {
  beforeEach(() => {
    isolatedStore();
    const sb = makeSupabaseFake();
    setAdminForTests(() => sb.fake as never); // placeById fallback (Supabase cache)
  });

  it("accumulates likes and dislikes per tag", async () => {
    await upsertPlace(p("f1", { tags: ["onsen", "food"] }));
    await applyFeedback("f1", true, ["onsen", "food"]);
    await applyFeedback("f1", true, ["onsen"]);
    const profile = getProfile();
    expect(profile.onsen).toBe(2);
    expect(profile.food).toBe(1);
  });

  it("uses the tags sent from the card over cached tags", async () => {
    await upsertPlace(p("f2", { tags: ["park"] }));
    await applyFeedback("f2", true, ["onsen"]); // card said onsen
    expect(getProfile().onsen).toBe(1);
    expect(getProfile().park).toBeUndefined();
  });

  it("clamps weights to ±5", async () => {
    await upsertPlace(p("f3", { tags: ["onsen"] }));
    for (let i = 0; i < 7; i++) await applyFeedback("f3", true, ["onsen"]);
    expect(getProfile().onsen).toBe(5);
    for (let i = 0; i < 10; i++) await applyFeedback("f3", false, ["onsen"]);
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

  it("degrades to an empty profile when the store is unavailable (serverless read-only fs)", () => {
    // point the store under an existing FILE so mkdir fails fast
    const dir = mkdtempSync(path.join(tmpdir(), "tabi-store-"));
    writeFileSync(path.join(dir, "blocker"), "x");
    setDataDir(path.join(dir, "blocker", "sub"));
    expect(getProfile()).toEqual({});
    expect(resetProfile()).toEqual({});
    setProfileWeight("onsen", 3);
    expect(getProfile()).toEqual({});
  });
});
