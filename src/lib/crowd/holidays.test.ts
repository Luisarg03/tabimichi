import { describe, it, expect } from "vitest";
import { isInJapan, isJapaneseHoliday, japaneseHolidays } from "@/lib/crowd/holidays";

/** Destination-local date (local wall clock in UTC fields, app convention). */
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("Japanese holidays", () => {
  it("knows the 2026 calendar, including the days the rules exist for", () => {
    // verified against the Cabinet Office list for 2026
    for (const iso of [
      "2026-01-01", // 元日
      "2026-01-12", // 成人の日 — second Monday
      "2026-02-11", // 建国記念の日
      "2026-02-23", // 天皇誕生日
      "2026-03-20", // 春分の日
      "2026-04-29", // 昭和の日
      "2026-05-04", // みどりの日
      "2026-05-06", // 振替休日 (5/3 fell on a Sunday)
      "2026-07-20", // 海の日 — third Monday
      "2026-09-21", // 敬老の日 — third Monday
      "2026-09-22", // 国民の休日 — weekday between two holidays (Silver Week)
      "2026-09-23", // 秋分の日
      "2026-10-12", // スポーツの日 — second Monday
      "2026-11-23", // 勤労感謝の日
    ]) {
      expect(isJapaneseHoliday(d(iso)), iso).toBe(true);
    }
  });

  it("keeps ordinary days ordinary", () => {
    for (const iso of ["2026-06-10", "2026-06-13", "2026-09-24", "2026-12-25"]) {
      expect(isJapaneseHoliday(d(iso)), iso).toBe(false);
    }
  });

  it("computes other years from the same rules", () => {
    // 2025: 成人の日 2nd Monday, 秋分の日 23rd; 2027: 海の日 3rd Monday
    expect(isJapaneseHoliday(d("2025-01-13"))).toBe(true);
    expect(isJapaneseHoliday(d("2025-09-23"))).toBe(true);
    expect(isJapaneseHoliday(d("2027-07-19"))).toBe(true);
    // 17 named holidays in 2026 (16 fixed + the Silver Week bridge) plus the
    // May 6 substitute day, which is a day off but not a named 祝日
    expect(japaneseHolidays(2026).size).toBe(18);
  });

  it("bails out outside the formula's range and outside Japan", () => {
    expect(isInJapan(35.68, 139.76)).toBe(true);
    expect(isInJapan(48.85, 2.35)).toBe(false); // Paris
    expect(isJapaneseHoliday(d("1975-01-01"))).toBe(false);
  });
});
