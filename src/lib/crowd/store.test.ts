import { describe, it, expect, beforeEach } from "vitest";
import { persistCrowdReport, readCrowdReports, setAdminForTests } from "@/lib/crowd/store";
import { getLocalCrowdReports } from "@/lib/db";
import { isolatedStore } from "@/test-utils/helpers";

/**
 * Minimal stand-in for the admin client: only the query chain the store uses.
 * The real thing is covered by the place-cache fake; here the point is the
 * report mapping and the local/cloud merge.
 */
function fakeAdmin(rows: Array<Record<string, unknown>> = []) {
  const inserted: Array<Record<string, unknown>> = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => chain,
    insert: (row: Record<string, unknown>) => {
      inserted.push(row);
      return Promise.resolve({ error: null });
    },
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return {
    inserted,
    fake: { from: () => chain },
  };
}

const report = (over: Record<string, unknown> = {}) => ({
  placeId: "p1",
  level: 2 as const,
  at: Date.now(),
  localHour: 12,
  weekend: false,
  ...over,
});

describe("crowd report store", () => {
  beforeEach(() => {
    isolatedStore();
    setAdminForTests(() => {
      throw new Error("no supabase in this test");
    });
  });

  it("persists anonymously to the local store and reads it back", async () => {
    await persistCrowdReport(report(), null);
    const local = getLocalCrowdReports(["p1"], Date.now() - 86_400_000);
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({ placeId: "p1", level: 2, weekend: false });

    const map = await readCrowdReports(["p1"], null);
    expect(map.get("p1")).toHaveLength(1);
    expect(map.get("p1")![0].localHour).toBe(12);
  });

  it("writes to Supabase for a signed-in user and maps rows back", async () => {
    const sb = fakeAdmin([
      {
        place_id: "p2",
        level: 1,
        reported_at: new Date().toISOString(),
        local_hour: 18.5,
        weekend: true,
      },
    ]);
    setAdminForTests(() => sb.fake as never);

    await persistCrowdReport(report({ placeId: "p2" }), "user-1");
    expect(sb.inserted[0]).toMatchObject({ place_id: "p2", user_id: "user-1", level: 2 });

    const map = await readCrowdReports(["p2"], "user-1");
    const row = map.get("p2")![0];
    expect(row).toMatchObject({ placeId: "p2", level: 1, weekend: true });
    expect(row.localHour).toBe(18.5);
  });

  it("degrades to no observations when the store blows up", async () => {
    setAdminForTests(() => {
      throw new Error("supabase down");
    });
    await expect(persistCrowdReport(report(), "user-1")).resolves.toBeUndefined();
    await expect(readCrowdReports(["p1"], "user-1")).resolves.toBeInstanceOf(Map);
  });

  it("does not query anything for an empty id list", async () => {
    const map = await readCrowdReports([], "user-1");
    expect(map.size).toBe(0);
  });
});
