/**
 * Optional interest keyword: "pokemon", "book off", "gatos"…
 * Normalization + name matching.
 *
 * NO alias table and NO LLM: the keyword passes RAW to Google (brands,
 * English and Japanese terms work as-is — verified live). Spanish words that
 * Google doesn't understand ("gatos" → ZERO_RESULTS) are translated by the
 * free keyless MyMemory API (lib/translate.ts), cached per term.
 */

/** Lowercase, collapse whitespace, strip diacritics ("Pokémon" → "pokemon"). */
export function normalizeKeyword(kw: string): string {
  return kw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokens used for name matching: the raw keyword plus the space-stripped
 * variant ("book off" must match "BOOKOFF"). Callers may append tokens of
 * a translated term so "gatos" also matches "Cat Cafe".
 */
export function keywordTokens(kw: string): string[] {
  const n = normalizeKeyword(kw);
  if (!n) return [];
  const tokens = new Set<string>([n]);
  tokens.add(n.replace(/\s+/g, ""));
  return [...tokens];
}

/** Does a place name contain any keyword token? (Latin script; case/diacritics insensitive.) */
export function matchesKeyword(name: string, tokens: string[]): boolean {
  if (!name || tokens.length === 0) return false;
  const n = normalizeKeyword(name);
  const compact = n.replace(/\s+/g, "");
  return tokens.some((t) => n.includes(t) || compact.includes(t.replace(/\s+/g, "")));
}
