import { describe, it, expect } from "vitest";
import { parseWikiRef } from "@/components/WikiPhoto";

describe("parseWikiRef", () => {
  it("splits lang:title", () => {
    expect(parseWikiRef("ja:渋温泉")).toEqual({ lang: "ja", title: "渋温泉" });
    expect(parseWikiRef("en:Osaka_Castle")).toEqual({ lang: "en", title: "Osaka Castle" });
  });

  it("rejects Q-ids and garbage", () => {
    expect(parseWikiRef("Q12345")).toBeNull();
    expect(parseWikiRef("ja:Q12345")).toBeNull();
    expect(parseWikiRef("no-colon-here")).toBeNull();
    expect(parseWikiRef("")).toBeNull();
  });
});
