/**
 * Free, keyless ES→EN translation for interest keywords (MyMemory API).
 * Used ONLY when the user typed a keyword, and cached per term — the first
 * use adds ~300 ms, every later use of the same keyword adds zero latency.
 * Non-keyword requests never touch this layer.
 *
 * Policy: Japanese terms (kana/kanji) pass raw — Google indexes them as-is.
 * English/brand terms come back unchanged and are used raw.
 */

import { normalizeKeyword } from "./keywords";

const cache = new Map<string, string>();
const TIMEOUT_MS = 5000;

/** Testability: drop cached translations. */
export function clearTranslateCache(): void {
  cache.clear();
}

/** CJK characters → Google indexes them directly, no translation needed. */
const CJK_RE = /[\u3040-\u30ff\u4e00-\u9fff]/;

/**
 * Translate a Spanish interest term to the English term Google indexes.
 * Falls back to the raw term on any failure (network, timeout, quota).
 */
export async function translateEsEn(term: string): Promise<string> {
  const cached = cache.get(term);
  if (cached !== undefined) return cached;
  if (CJK_RE.test(term)) {
    cache.set(term, term);
    return term;
  }

  try {
    const url =
      "https://api.mymemory.translated.net/get?" +
      new URLSearchParams({ q: term, langpair: "es|en" });
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`translate-http-${res.status}`);
    const data = (await res.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number;
    };
    const out = data?.responseData?.translatedText?.trim() ?? "";
    if (data?.responseStatus !== 200 || !out) throw new Error("translate-bad-response");
    // unchanged term (e.g. "snoopy" → "Snoopy") → use the raw keyword
    const result = normalizeKeyword(out) === normalizeKeyword(term) ? term : out;
    cache.set(term, result);
    return result;
  } catch {
    cache.set(term, term);
    return term;
  }
}
