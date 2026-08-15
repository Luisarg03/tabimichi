/**
 * Opening-hours evaluation from Google Place Details `periods`.
 * Day: 0=Sunday … 6=Saturday (Google convention). Time: "HHMM".
 * `date` must expose JST wall-clock via getUTC* (see lib/jst.ts).
 */

export interface OpenPeriod {
  open: { day: number; time: string };
  close?: { day: number; time: string };
}

function toMinutes(hhmm: string): number {
  return parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(2, 4), 10);
}

/**
 * Is the place open at `date`? Returns:
 *  - true/false when periods are known
 *  - null when no periods (unknown — caller decides)
 */
export function isOpenAt(periods: OpenPeriod[] | undefined, date: Date): boolean | null {
  if (!periods || periods.length === 0) return null;
  const dow = date.getUTCDay();
  const mins = date.getUTCHours() * 60 + date.getUTCMinutes();

  for (const p of periods) {
    const openM = toMinutes(p.open.time);
    if (p.close) {
      const closeM = toMinutes(p.close.time);
      if (p.close.day === p.open.day) {
        if (dow === p.open.day && mins >= openM && mins < closeM) return true;
      } else {
        // overnight (e.g. bar open 20:00 → 02:00 next day)
        if (dow === p.open.day && mins >= openM) return true;
        if (dow === p.close.day && mins < closeM) return true;
      }
    } else if (dow === p.open.day && mins >= openM) {
      return true;
    }
  }
  return false;
}
