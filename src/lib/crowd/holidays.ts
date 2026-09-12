/**
 * Japanese public holidays, computed in code.
 *
 * Holidays behave like weekends for crowds — often more so: a 連休 sends
 * everyone to the same temple, and Silver Week turns a Tuesday into a Sunday.
 * The estimate needs to know, and it needs to know instantly: fetching the
 * Cabinet Office CSV on the recommendation hot path would add a network
 * dependency (and a cache table) for data that changes once a year. The rules
 * are stable and short, so they are computed instead.
 *
 * Covered: the fixed dates, the four Happy Mondays, both equinoxes, 振替休日
 * (a Sunday holiday pushes to the next free day) and 国民の休日 (a lone
 * weekday between two holidays becomes one — Silver Week).
 *
 * Destinations outside Japan get no holidays: weekday/weekend only.
 */

/** Rough Japan bounding box — holidays only apply inside it. */
export const JAPAN_BBOX = { minLat: 24, maxLat: 46, minLng: 122, maxLng: 146 };

export function isInJapan(lat: number, lng: number): boolean {
  return (
    lat >= JAPAN_BBOX.minLat &&
    lat <= JAPAN_BBOX.maxLat &&
    lng >= JAPAN_BBOX.minLng &&
    lng <= JAPAN_BBOX.maxLng
  );
}

const MONTH_DAY: Array<[number, number]> = [
  [1, 1], // 元日
  [2, 11], // 建国記念の日
  [2, 23], // 天皇誕生日
  [4, 29], // 昭和の日
  [5, 3], // 憲法記念日
  [5, 4], // みどりの日
  [5, 5], // こどもの日
  [8, 11], // 山の日
  [11, 3], // 文化の日
  [11, 23], // 勤労感謝の日
];

/** nth Monday of a month (1-based n). */
function nthMonday(year: number, month: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  const offset = (8 - first) % 7; // days until the first Monday
  return 1 + offset + (n - 1) * 7;
}

/** Equinox day approximation (National Astronomical Observatory formula,
 *  valid 1980–2099). */
function equinoxDay(year: number, spring: boolean): number {
  const base = spring ? 20.8431 : 23.2488;
  const shift = 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4);
  return Math.floor(base + shift);
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

const cache = new Map<number, Set<string>>();

/** All holiday dates of a year, as ISO strings, substitute/bridge days included. */
export function japaneseHolidays(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;

  const dates = new Set<string>(MONTH_DAY.map(([m, d]) => iso(year, m, d)));
  dates.add(iso(year, 1, nthMonday(year, 1, 2))); // 成人の日
  dates.add(iso(year, 7, nthMonday(year, 7, 3))); // 海の日
  dates.add(iso(year, 9, nthMonday(year, 9, 3))); // 敬老の日
  dates.add(iso(year, 10, nthMonday(year, 10, 2))); // スポーツの日
  dates.add(iso(year, 3, equinoxDay(year, true))); // 春分の日
  dates.add(iso(year, 9, equinoxDay(year, false))); // 秋分の日

  // 振替休日: a holiday on Sunday moves to the next day that is not a holiday
  for (const date of [...dates]) {
    const [y, m, d] = date.split("-").map(Number);
    if (dayOfWeek(y, m, d) !== 0) continue;
    let next = d + 1;
    let month = m;
    let year2 = y;
    while (true) {
      const daysInMonth = new Date(Date.UTC(year2, month, 0)).getUTCDate();
      if (next > daysInMonth) {
        next = 1;
        month += 1;
        if (month > 12) {
          month = 1;
          year2 += 1;
        }
      }
      const candidate = iso(year2, month, next);
      if (!dates.has(candidate)) {
        dates.add(candidate);
        break;
      }
      next += 1;
    }
  }

  // 国民の休日: a single non-holiday weekday between two holidays
  const days = new Date(Date.UTC(year, 11, 31)).getTime();
  for (let t = Date.UTC(year, 0, 2); t < days; t += 86_400_000) {
    const d = new Date(t);
    const prev = new Date(t - 86_400_000);
    const next = new Date(t + 86_400_000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (
      dates.has(iso(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate())) &&
      dates.has(iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()))
    ) {
      dates.add(iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
    }
  }

  cache.set(year, dates);
  return dates;
}

/**
 * Is this destination-local date a Japanese holiday?
 * `dateLocal` follows the app convention: local wall clock in UTC fields.
 */
export function isJapaneseHoliday(dateLocal: Date): boolean {
  const year = dateLocal.getUTCFullYear();
  if (year < 1980 || year > 2099) return false; // equinox formula range
  const key = iso(year, dateLocal.getUTCMonth() + 1, dateLocal.getUTCDate());
  return japaneseHolidays(year).has(key);
}

/** Test seam. */
export function resetHolidayCacheForTests(): void {
  cache.clear();
}
