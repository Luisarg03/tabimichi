import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clearTranslateCache, translateEsEn } from "@/lib/translate";
import { mockFetch, jsonResponse, urlContains } from "@/test-utils/helpers";

const myMemoryOk = (text: string) =>
  jsonResponse({ responseData: { translatedText: text }, responseStatus: 200 });

beforeEach(() => {
  clearTranslateCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("translateEsEn", () => {
  it("translates Spanish terms via MyMemory", async () => {
    mockFetch([
      {
        match: urlContains("api.mymemory.translated.net"),
        response: (u) => {
          expect(u).toContain("q=gatos");
          expect(u).toMatch(/langpair=es(%7C|\|)en/);
          return myMemoryOk("cat");
        },
      },
    ]);
    expect(await translateEsEn("gatos")).toBe("cat");
  });

  it("keeps English terms and brand names unchanged", async () => {
    mockFetch([
      { match: urlContains("api.mymemory"), response: () => myMemoryOk("Snoopy") },
    ]);
    expect(await translateEsEn("snoopy")).toBe("snoopy"); // normalized-equal → raw
  });

  it("skips Japanese terms entirely (no network)", async () => {
    let calls = 0;
    mockFetch([{ match: () => true, response: () => (calls++, myMemoryOk("x")) }]);
    expect(await translateEsEn("ポケモン")).toBe("ポケモン");
    expect(calls).toBe(0);
  });

  it("caches per term (no second network call)", async () => {
    let calls = 0;
    mockFetch([
      {
        match: urlContains("api.mymemory"),
        response: () => (calls++, myMemoryOk("cat")),
      },
    ]);
    expect(await translateEsEn("gatos")).toBe("cat");
    expect(await translateEsEn("gatos")).toBe("cat");
    expect(calls).toBe(1);
  });

  it("falls back to the raw term on API failure", async () => {
    mockFetch([{ match: urlContains("api.mymemory"), response: () => jsonResponse({}, 500) }]);
    expect(await translateEsEn("gatos")).toBe("gatos");
  });

  it("falls back to raw on a malformed response", async () => {
    mockFetch([{ match: urlContains("api.mymemory"), response: () => jsonResponse({ foo: 1 }) }]);
    expect(await translateEsEn("gatos")).toBe("gatos");
  });
});
