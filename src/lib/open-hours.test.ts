import { describe, it, expect } from "vitest";
import { isOpenAt } from "@/lib/open-hours";

const sun = new Date("2026-08-16T09:00:00.000Z"); // Sunday 09:00 (UTC fields = JST)
const mon = new Date("2026-08-17T01:00:00.000Z"); // Monday 01:00

describe("isOpenAt", () => {
  it("returns null when no periods", () => {
    expect(isOpenAt(undefined, sun)).toBeNull();
    expect(isOpenAt([], sun)).toBeNull();
  });

  it("same-day hours: open at opening, closed before/at close", () => {
    const p = [{ open: { day: 0, time: "0900" }, close: { day: 0, time: "2200" } }];
    expect(isOpenAt(p, new Date("2026-08-16T09:00:00.000Z"))).toBe(true);
    expect(isOpenAt(p, new Date("2026-08-16T08:59:00.000Z"))).toBe(false);
    expect(isOpenAt(p, new Date("2026-08-16T21:59:00.000Z"))).toBe(true);
    expect(isOpenAt(p, new Date("2026-08-16T22:00:00.000Z"))).toBe(false);
    expect(isOpenAt(p, new Date("2026-08-17T10:00:00.000Z"))).toBe(false); // Monday
  });

  it("overnight periods (bar Sun 20:00 → Mon 02:00)", () => {
    const p = [{ open: { day: 0, time: "2000" }, close: { day: 1, time: "0200" } }];
    expect(isOpenAt(p, new Date("2026-08-16T21:00:00.000Z"))).toBe(true); // Sun 21
    expect(isOpenAt(p, new Date("2026-08-16T19:00:00.000Z"))).toBe(false); // Sun 19
    expect(isOpenAt(p, new Date("2026-08-17T01:00:00.000Z"))).toBe(true); // Mon 01
    expect(isOpenAt(p, new Date("2026-08-17T02:00:00.000Z"))).toBe(false); // Mon 02
    expect(isOpenAt(p, new Date("2026-08-17T03:00:00.000Z"))).toBe(false); // Mon 03
  });

  it("period without close: open from that time on", () => {
    const p = [{ open: { day: 0, time: "0900" } }];
    expect(isOpenAt(p, sun)).toBe(true);
    expect(isOpenAt(p, new Date("2026-08-16T08:00:00.000Z"))).toBe(false);
    expect(isOpenAt(p, new Date("2026-08-16T23:00:00.000Z"))).toBe(true);
  });

  it("24h-style period (0000 → next day 0000) covers its day, then closes", () => {
    const p = [{ open: { day: 0, time: "0000" }, close: { day: 1, time: "0000" } }];
    expect(isOpenAt(p, sun)).toBe(true); // Sunday all day
    expect(isOpenAt(p, new Date("2026-08-17T01:00:00.000Z"))).toBe(false); // Monday closed
    // a real 24/7 place declares a period per day
    const week = [
      { open: { day: 0, time: "0000" }, close: { day: 1, time: "0000" } },
      { open: { day: 1, time: "0000" }, close: { day: 2, time: "0000" } },
    ];
    expect(isOpenAt(week, sun)).toBe(true);
    expect(isOpenAt(week, mon)).toBe(true);
  });

  it("matches multiple periods (weekday + weekend)", () => {
    const p = [
      { open: { day: 0, time: "1000" }, close: { day: 0, time: "1800" } },
      { open: { day: 1, time: "0900" }, close: { day: 1, time: "1700" } },
    ];
    expect(isOpenAt(p, new Date("2026-08-16T11:00:00.000Z"))).toBe(true); // Sun
    expect(isOpenAt(p, new Date("2026-08-17T09:30:00.000Z"))).toBe(true); // Mon
    expect(isOpenAt(p, new Date("2026-08-17T17:30:00.000Z"))).toBe(false); // Mon after close
  });
});
