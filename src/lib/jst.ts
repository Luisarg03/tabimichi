/**
 * Simulation helpers: evaluate the app as if "now" were a given hour in
 * Japan (UTC+9). The returned Date is built so its UTC fields equal the JST
 * wall-clock fields (day-of-week, hour…) — consumers use getUTC* getters.
 */

export const SIM_PRESETS = [
  { id: "morning", hour: 9, labelKey: "morning" },
  { id: "afternoon", hour: 15, labelKey: "afternoon" },
  { id: "evening", hour: 21, labelKey: "evening" },
  { id: "late", hour: 3, labelKey: "late" },
] as const;

/**
 * Date with the given JST hour (minute 0) on today's JST calendar day.
 * The JST wall-clock components are stored in the UTC fields directly
 * (date parts are already the JST calendar day), so consumers use
 * getUTC* getters to read JST time.
 */
export function jstSimulatedDate(hourJST: number): Date {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const d = jst.getUTCDate();
  return new Date(Date.UTC(y, m, d, hourJST, 0, 0));
}

/** "YYYY-MM-DDTHH:00" in JST wall-clock (for matching Open-Meteo hourly rows). */
export function jstHourStamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:00`;
}
