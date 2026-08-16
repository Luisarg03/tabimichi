import { describe, it, expect } from "vitest";
import { keywordTokens, matchesKeyword, normalizeKeyword } from "@/lib/keywords";

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

describe("keywordTokens", () => {
  it("includes raw and compact variants only (no alias table)", () => {
    const tokens = keywordTokens("book off");
    expect(tokens).toContain("book off");
    expect(tokens).toContain("bookoff");
    expect(tokens).toHaveLength(2);
    expect(keywordTokens("gatos")).toEqual(["gatos"]);
  });
});

describe("matchesKeyword", () => {
  it("matches Latin names case/diacritics-insensitively", () => {
    expect(matchesKeyword("Pokémon Center Tokyo", keywordTokens("pokemon"))).toBe(true);
    expect(matchesKeyword("BOOKOFF Store", keywordTokens("book off"))).toBe(true);
  });

  it("does not match without a translation (raw term only)", () => {
    // 'gatos' does not match 'Cat Cafe' by itself — the LLM-translated term
    // ('cat') is what bridges that gap, appended by the caller (recommend)
    expect(matchesKeyword("Cat Cafe MoCHA", keywordTokens("gatos"))).toBe(false);
    expect(matchesKeyword("Sukiya", keywordTokens("gatos"))).toBe(false);
    expect(matchesKeyword("Zenko-ji Temple", keywordTokens("pokemon"))).toBe(false);
  });

  it("matches when the translated term is appended", () => {
    const tokens = [...keywordTokens("gatos"), ...keywordTokens("cat")];
    expect(matchesKeyword("Cat Cafe MoCHA", tokens)).toBe(true);
  });

  it("never matches empty keyword or name", () => {
    expect(matchesKeyword("", keywordTokens("pokemon"))).toBe(false);
    expect(matchesKeyword("Pokemon", [])).toBe(false);
  });
});
