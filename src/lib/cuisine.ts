/**
 * Restaurant kind, derived from the NAME only.
 *
 * Why the name and nothing else: Google's own `types`/`price_level` would be a
 * richer signal, but they are not persisted in place_cache, so a cached search
 * would group differently from a live one — a ranking that changes with cache
 * temperature is worse than no grouping. Names are the one field that is
 * always there and always identical between both paths.
 *
 * Coverage is deliberately partial (~30-40% of Japanese restaurant names name
 * their dish: "東京ラーメン 大番", "すし好", "浜そば"). Everything else falls back
 * to "other", which is fine: the consumer is a diversity rotation, not a
 * classifier — it only needs to stop serving five ramen shops in a row.
 *
 * `local` marks a named Japanese speciality (ramen/sushi/soba/…). Chains and
 * anonymous names ("大斗", "Wadachi") do not qualify, which is what makes it a
 * usable quality signal on top of the rating.
 */
export type CuisineKind =
  | "ramen"
  | "sushi"
  | "soba"
  | "udon"
  | "donburi"
  | "curry"
  | "yakiniku"
  | "okonomiyaki"
  | "tempura"
  | "unagi"
  | "tonkatsu"
  | "yakitori"
  | "cafe"
  | "bakery"
  | "bar"
  | "sweets"
  | "other";

interface CuisineRule {
  kind: CuisineKind;
  re: RegExp;
  /** a Japanese dish category (vs. cafe/bakery/bar, which are not "local food") */
  local?: boolean;
}

// Order matters: first match wins. Romanized terms are matched against the
// lowercase name; CJK against the raw name.
const RULES: CuisineRule[] = [
  { kind: "ramen", re: /ラーメン|らーめん|らぁめん|拉麺|中華そば|ramen|noodle/i, local: true },
  { kind: "sushi", re: /すし|寿司|鮨|sushi|回転寿司/i, local: true },
  { kind: "soba", re: /そば|蕎麦|soba/i, local: true },
  { kind: "udon", re: /うどん|饂飩|udon/i, local: true },
  { kind: "donburi", re: /丼|どんぶり|donburi|親子丼/i, local: true },
  { kind: "curry", re: /カレー|curry|ココイチ/i, local: true },
  { kind: "yakiniku", re: /焼肉|焼き肉|yakiniku|ホルモン|ジンギスカン/i, local: true },
  { kind: "okonomiyaki", re: /お好み焼|もんじゃ|okonomiyaki|たこ焼|蛸焼/i, local: true },
  { kind: "tempura", re: /天ぷら|天婦羅|tempura/i, local: true },
  { kind: "unagi", re: /うなぎ|鰻|unagi/i, local: true },
  { kind: "tonkatsu", re: /とんかつ|トンカツ|豚カツ|tonkatsu|かつ丼/i, local: true },
  { kind: "yakitori", re: /焼鳥|焼き鳥|やきとり|yakitori|串焼/i, local: true },
  { kind: "cafe", re: /喫茶|cafe|カフェ|珈琲|コーヒー|coffee|kissa/i },
  { kind: "bakery", re: /ベーカリー|bakery|パン|boulangerie|ブーランジェ/i },
  { kind: "bar", re: /\bbar\b|バー|酒場|居酒屋|izakaya|スタンド/i },
  { kind: "sweets", re: /甘味|和菓子|洋菓子|スイーツ|パフェ|アイス|ジェラート|sweets|dessert|たい焼|大福/i },
];

/** Restaurant kind by name; "other" when the name does not say (or the place
 *  is not tagged as food at all — a "ラーメン記念館" museum must not classify). */
export function cuisineOf(name: string, tags: string[] = []): CuisineKind {
  if (!tags.includes("food")) return "other";
  for (const rule of RULES) if (rule.re.test(name)) return rule.kind;
  return "other";
}

/** True when the name announces a Japanese speciality — a weak but free
 *  quality signal that needs no extra API call and survives the cache. */
export function isLocalCuisine(name: string): boolean {
  return RULES.some((r) => r.local && r.re.test(name));
}
