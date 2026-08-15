import { describe, it, expect } from "vitest";
import { jstSimulatedDate, jstHourStamp, SIM_PRESETS } from "@/lib/jst";

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
