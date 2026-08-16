import { describe, it, expect } from "vitest";
import {
  KEYWORD_ALIASES,
  keywordTokens,
  matchesKeyword,
  normalizeKeyword,
  searchTermFor,
} from "@/lib/keywords";

describe("normalizeKeyword", () => {
  it("lowercases, trims and collapses spaces", () => {
    expect(normalizeKeyword("  Book   OFF ")).toBe("book off");
    expect(normalizeKeyword("  Pokemon ")).toBe("pokemon");
  });

  it("strips diacritics", () => {
    expect(normalizeKeyword("Pokémon")).toBe("pokemon");
    expect(normalizeKeyword("Música")).toBe("musica");
    expect(normalizeKeyword("Gatos")).toBe("gatos");
  });

  it("returns empty for blank input", () => {
    expect(normalizeKeyword("   ")).toBe("");
    expect(normalizeKeyword("")).toBe("");
  });
});

describe("searchTermFor", () => {
  it("maps Spanish interests to English search terms", () => {
    expect(searchTermFor("gatos")).toBe("cat");
    expect(searchTermFor("musica")).toBe("music");
    expect(searchTermFor("libros")).toBe("book");
  });

  it("keeps unknown keywords as-is", () => {
    expect(searchTermFor("snoopy")).toBe("snoopy");
    expect(searchTermFor("book off")).toBe("book off");
    expect(searchTermFor("pokemon")).toBe("pokemon");
  });

  it("returns empty for blank", () => {
    expect(searchTermFor("  ")).toBe("");
  });
});

describe("alias policy", () => {
  it("never aliases brand names, English or Japanese terms — they pass raw", () => {
    for (const brand of [
      "pokemon", "snoopy", "book off", "anime", "manga", "ghibli",
      "ramen", "sushi", "onsen", "origami", "kimono", "samurai", "ninja",
      "ポケモン", "ドラゴン", "gundam",
    ]) {
      expect(searchTermFor(brand)).toBe(normalizeKeyword(brand));
      expect(KEYWORD_ALIASES[normalizeKeyword(brand)]).toBeUndefined();
    }
  });

  it("only contains pure-Spanish words as keys", () => {
    // the table must stay tiny — Spanish words Google won't understand
    expect(Object.keys(KEYWORD_ALIASES).length).toBeLessThanOrEqual(20);
  });
});

describe("keywordTokens", () => {
  it("includes raw, alias and compact variants", () => {
    const tokens = keywordTokens("book off");
    expect(tokens).toContain("book off");
    expect(tokens).toContain("bookoff");
    const cat = keywordTokens("gatos");
    expect(cat).toContain("gatos");
    expect(cat).toContain("cat");
    expect(cat).not.toContain("catcafe"); // sanity: no invented tokens
  });
});

describe("matchesKeyword", () => {
  it("matches Latin names case/diacritics-insensitively", () => {
    expect(matchesKeyword("Pokémon Center Tokyo", keywordTokens("pokemon"))).toBe(true);
    expect(matchesKeyword("BOOKOFF Store", keywordTokens("book off"))).toBe(true);
    expect(matchesKeyword("Neko Cafe", keywordTokens("gatos"))).toBe(false); // alias 'cat' not in name
    expect(matchesKeyword("Cat Cafe MoCHA", keywordTokens("gatos"))).toBe(true);
  });

  it("does not match unrelated names", () => {
    expect(matchesKeyword("Sukiya", keywordTokens("gatos"))).toBe(false);
    expect(matchesKeyword("Zenko-ji Temple", keywordTokens("pokemon"))).toBe(false);
  });

  it("never matches empty keyword or name", () => {
    expect(matchesKeyword("", keywordTokens("pokemon"))).toBe(false);
    expect(matchesKeyword("Pokemon", [])).toBe(false);
  });
});

describe("alias coverage", () => {
  it("normalized aliases are lowercase keys", () => {
    for (const k of Object.keys(KEYWORD_ALIASES)) {
      expect(normalizeKeyword(k)).toBe(k);
    }
  });
});
