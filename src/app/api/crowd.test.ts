import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as reportPOST } from "@/lib/api/routes/crowd/report";
import { getLocalCrowdReports } from "@/lib/db";
import { isolatedStore } from "@/test-utils/helpers";

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/crowd/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("/api/crowd/report", () => {
  beforeEach(() => {
    isolatedStore();
  });

  it("stores an observation with the destination-local hour", async () => {
    const res = await reportPOST(post({ placeId: "o_node_1", level: 2, lat: 34.685, lng: 135.8 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cloud: false });

    const stored = getLocalCrowdReports(["o_node_1"], Date.now() - 60_000);
    expect(stored).toHaveLength(1);
    expect(stored[0].level).toBe(2);
    expect(stored[0].localHour).toBeGreaterThanOrEqual(0);
    expect(stored[0].localHour).toBeLessThan(24);
    expect(typeof stored[0].weekend).toBe("boolean");
  });

  it("rejects a level outside 0..2", async () => {
    const res = await reportPOST(post({ placeId: "p", level: 3 }));
    expect(res.status).toBe(400);
    expect(getLocalCrowdReports(["p"], 0)).toHaveLength(0);
  });

  it("rejects a missing place id, bad coords and broken json", async () => {
    expect((await reportPOST(post({ level: 1 }))).status).toBe(400);
    expect((await reportPOST(post({ placeId: "", level: 1 }))).status).toBe(400);
    expect((await reportPOST(post({ placeId: "p", level: 1, lat: 91, lng: Number.NaN }))).status).toBe(400);
    expect((await reportPOST(post("{not json"))).status).toBe(400);
  });

  it("accepts a report without coordinates (places the clock on server time)", async () => {
    const res = await reportPOST(post({ placeId: "no-coords", level: 0 }));
    expect(res.status).toBe(200);
    const stored = getLocalCrowdReports(["no-coords"], Date.now() - 60_000);
    expect(stored).toHaveLength(1);
    expect(stored[0].level).toBe(0);
  });
});
