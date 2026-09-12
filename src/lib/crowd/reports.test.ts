import { describe, it, expect } from "vitest";
import {
  blendWithReports,
  hourBucket,
  learnedDelta,
  reportValue,
  RECENT_REPORT_MS,
  type CrowdReport,
} from "@/lib/crowd/reports";

const at = (minsAgo: number) => Date.now() - minsAgo * 60_000;

const report = (over: Partial<CrowdReport> = {}): CrowdReport => ({
  placeId: "p1",
  level: 1,
  at: at(10),
  localHour: 12,
  weekend: false,
  ...over,
});

describe("crowd reports", () => {
  it("scales report levels onto the crowd scale", () => {
    expect(reportValue(0)).toBeLessThan(reportValue(1));
    expect(reportValue(1)).toBeLessThan(reportValue(2));
  });

  it("ignores the model when two fresh reports agree", () => {
    const blended = blendWithReports(0.9, [report({ level: 0 }), report({ level: 0, at: at(30) })], Date.now());
    expect(blended.source).toBe("observed");
    expect(blended.level).toBeLessThan(0.35);
    expect(blended.recentCount).toBe(2);
    expect(blended.observedAt).toBeDefined();
  });

  it("treats one report as a hint, not the truth", () => {
    const blended = blendWithReports(0.9, [report({ level: 0, at: at(60) })], Date.now());
    expect(blended.source).toBe("mixed");
    expect(blended.level).toBeGreaterThan(0.3);
    expect(blended.level).toBeLessThan(0.9);
  });

  it("forgets reports older than the recent window", () => {
    const stale = report({ at: at(RECENT_REPORT_MS / 60_000 + 5), level: 2 });
    const blended = blendWithReports(0.4, [stale], Date.now());
    expect(blended.source).toBe("model");
    expect(blended.level).toBeCloseTo(0.4, 5);
    expect(blended.recentCount).toBe(0);
  });

  it("learns a per-place correction from older reports in the same bucket", () => {
    const weekend = [
      report({ level: 2, at: at(60 * 24 * 7), localHour: 12, weekend: false }),
      report({ level: 2, at: at(60 * 24 * 14), localHour: 13, weekend: false }),
    ];
    expect(learnedDelta(weekend, { hour: 12, weekend: false, nowMs: Date.now() })).toBeGreaterThan(0);
    // a different bucket, or a different weekday class, learns nothing
    expect(learnedDelta(weekend, { hour: 22, weekend: false, nowMs: Date.now() })).toBe(0);
    expect(learnedDelta(weekend, { hour: 12, weekend: true, nowMs: Date.now() })).toBe(0);
  });

  it("needs more than one sample before it trusts a pattern", () => {
    const single = [report({ level: 2, at: at(60 * 24 * 7), localHour: 12 })];
    expect(learnedDelta(single, { hour: 12, weekend: false, nowMs: Date.now() })).toBe(0);
  });

  it("caps how far old reports can move the model", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      report({ level: 2, at: at(60 * 24 * (i + 1)), localHour: 12 })
    );
    const delta = learnedDelta(many, { hour: 12, weekend: false, nowMs: Date.now() });
    expect(delta).toBeLessThanOrEqual(0.2);
    expect(hourBucket(12)).toBe(4);
  });
});
