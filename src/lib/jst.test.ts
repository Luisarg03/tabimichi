import { describe, it, expect } from "vitest";
import { jstSimulatedDate, jstHourStamp, localTimeAt, SIM_PRESETS } from "@/lib/jst";

describe("jstSimulatedDate", () => {
  it("stores the JST wall-clock in UTC fields", () => {
    const d = jstSimulatedDate(9);
    expect(d.getUTCHours()).toBe(9);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it("uses today's JST calendar day", () => {
    const jstToday = new Date(Date.now() + 9 * 3600 * 1000);
    const d = jstSimulatedDate(15);
    expect(d.getUTCFullYear()).toBe(jstToday.getUTCFullYear());
    expect(d.getUTCMonth()).toBe(jstToday.getUTCMonth());
    expect(d.getUTCDate()).toBe(jstToday.getUTCDate());
  });

  it("round-trips through ISO", () => {
    const d = jstSimulatedDate(3);
    const back = new Date(d.toISOString());
    expect(back.getTime()).toBe(d.getTime());
  });
});

describe("jstHourStamp", () => {
  it("formats as YYYY-MM-DDTHH:00", () => {
    expect(jstHourStamp(jstSimulatedDate(21))).toMatch(/^\d{4}-\d{2}-\d{2}T21:00$/);
    expect(jstHourStamp(jstSimulatedDate(3))).toMatch(/^\d{4}-\d{2}-\d{2}T03:00$/);
  });
});

describe("SIM_PRESETS", () => {
  it("covers the four evaluation slots", () => {
    expect(SIM_PRESETS.map((p) => p.hour)).toEqual([9, 15, 21, 3]);
  });
});

describe("localTimeAt", () => {
  it("shifts a real instant to destination-local wall clock in UTC fields", () => {
    // 2026-08-16T00:30Z at lng 138.2 (Nagano ≈ UTC+9)
    const real = new Date("2026-08-16T00:30:00Z");
    const local = localTimeAt(real, 138.2);
    expect(local.getUTCHours()).toBe(9);
    expect(local.getUTCMinutes()).toBe(30);
    expect(local.getUTCDate()).toBe(16); // same calendar day
  });

  it("rounds the offset to whole hours (Japan = +9)", () => {
    const real = new Date("2026-01-01T00:00:00Z");
    expect(localTimeAt(real, 139.7).getUTCHours()).toBe(9); // Tokyo
    expect(localTimeAt(real, -3.7).getUTCHours()).toBe(0); // Madrid (UTC+1 → -1h)
  });
});
