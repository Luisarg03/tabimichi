/**
 * Optional interest keyword: "pokemon", "book off", "gatos"…
 * Normalization + Spanish→English aliases + name matching.
 *
 * The keyword drives BOTH discovery (Google text-search query) and scoring
 * (a boost for places whose name matches, exempting chain/hotel penalties
 * when the user asked for that place explicitly).
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

/** Common Spanish interest words → the English term Google indexes best. */
export const KEYWORD_ALIASES: Record<string, string> = {
  gatos: "cat",
  gato: "cat",
  perros: "dog",
  perro: "dog",
  libros: "book",
  libro: "book",
  musica: "music",
  arte: "art",
  flores: "flowers",
  dulces: "sweets",
  videojuegos: "video games",
  juegos: "games",
  antiguedades: "antiques",
  plantas: "plants",
  te: "tea",
  ramen: "ramen",
  sushi: "sushi",
  onsen: "onsen",
  anime: "anime",
  manga: "manga",
  ghibli: "ghibli",
  pokemon: "pokemon",
  snoopy: "snoopy",
  magia: "magic",
  ceramica: "ceramics",
  origami: "origami",
  kimono: "kimono",
  samurai: "samurai",
  ninja: "ninja",
  magos: "magic",
};

/** Primary term for the Google text-search query (alias if known). */
export function searchTermFor(kw: string): string {
  const n = normalizeKeyword(kw);
  if (!n) return "";
  return KEYWORD_ALIASES[n] ?? n;
}

/**
 * Tokens used for name matching: the raw keyword, its alias, and the
 * space-stripped variants ("book off" must match "BOOKOFF").
 */
export function keywordTokens(kw: string): string[] {
  const n = normalizeKeyword(kw);
  if (!n) return [];
  const tokens = new Set<string>([n]);
  const alias = KEYWORD_ALIASES[n];
  if (alias) {
    tokens.add(alias);
    tokens.add(alias.replace(/\s+/g, ""));
  }
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
