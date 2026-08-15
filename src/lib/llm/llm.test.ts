import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractJson, narrateTop } from "@/lib/llm";
import { chatComplete } from "@/lib/llm/client";
import type { LlmProvider } from "@/lib/llm/providers";
import { mockFetch, jsonResponse, urlContains, isolatedStore } from "@/test-utils/helpers";

const provider: LlmProvider = {
  id: "opencode-zen",
  name: "Zen",
  tier: "free",
  baseURL: "https://opencode.ai/zen/v1",
  apiKey: "sk-test",
  models: ["deepseek-v4-flash-free"],
};

const chat = (content: string, status = 200) =>
  jsonResponse({ choices: [{ message: { content } }] }, status);

describe("extractJson", () => {
  it("parses plain JSON", () => {
    const r = extractJson('{"summary":"s","narratives":[{"id":"a","why":"x"}]}');
    expect(r?.summary).toBe("s");
    expect(r?.narratives).toHaveLength(1);
  });

  it("parses JSON inside markdown fences", () => {
    const r = extractJson('```json\n{"narratives":[]}\n```');
    expect(r).not.toBeNull();
  });

  it("parses JSON surrounded by prose", () => {
    const r = extractJson('Aquí va: {"narratives":[{"id":"a","why":"b"}]} — fin');
    expect(r?.narratives?.[0]?.id).toBe("a");
  });

  it("returns null for invalid JSON", () => {
    expect(extractJson("no braces here")).toBeNull();
    expect(extractJson('{"narratives": [}')).toBeNull();
  });
});

describe("chatComplete", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the model content", async () => {
    mockFetch([{ match: urlContains("chat/completions"), response: () => chat("hola") }]);
    expect(await chatComplete(provider, { messages: [{ role: "user", content: "x" }] })).toBe("hola");
  });

  it("retries transient 5xx errors", async () => {
    let calls = 0;
    mockFetch([
      {
        match: urlContains("chat/completions"),
        response: () => (++calls === 1 ? jsonResponse({}, 500) : chat("ok")),
      },
    ]);
    expect(await chatComplete(provider, { messages: [] })).toBe("ok");
    expect(calls).toBe(2);
  });

  it("fails fast on 4xx (rate limit) without retries", async () => {
    let calls = 0;
    mockFetch([
      {
        match: urlContains("chat/completions"),
        response: () => {
          calls++;
          return jsonResponse({}, 429);
        },
      },
    ]);
    await expect(chatComplete(provider, { messages: [] })).rejects.toThrow("llm-http-429");
    expect(calls).toBe(1);
  });

  it("throws when content is empty", async () => {
    mockFetch([{ match: () => true, response: () => chat("") }]);
    await expect(chatComplete(provider, { messages: [] })).rejects.toThrow("llm-empty");
  });
});

describe("narrateTop — provider fallback (free 429 → paid)", () => {
  const opts = () => ({
    places: [
      {
        id: "g_1",
        source: "google" as const,
        name: "Zenko-ji",
        lat: 36.66,
        lng: 138.18,
        tags: ["temple"],
        distanceKm: 1.6,
        travelMin: 21,
        score: 80,
        reasons: [],
      },
    ],
    weather: {
      tempC: 23, feelsC: 25, precipMm: 0, snowCm: 0, windKmh: 8,
      code: 3, label: "cloudy", condition: "cloudy" as const, isNight: false, hourly: [], daily: [],
    },
    budget: "afternoon" as const,
    mode: "walking" as const,
    lang: "es",
    types: ["temple"],
  });

  beforeEach(() => {
    isolatedStore(); // empty config file — no leaked real keys
    process.env.OPENCODE_API_KEY = "sk-zen";
    process.env.OPENCODE_GO_API_KEY = "sk-go";
  });
  afterEach(() => {
    delete process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_GO_API_KEY;
    delete process.env.TABI_DATA_DIR;
    vi.unstubAllGlobals();
  });

  it("falls back from rate-limited zen to go and reports the provider", async () => {
    mockFetch([
      {
        match: (u) => u.includes("/zen/v1/chat/completions"),
        response: () => jsonResponse({}, 429),
      },
      {
        match: (u) => u.includes("/zen/go/v1/chat/completions"),
        response: () =>
          chat(
            '{"summary":"plan","narratives":[{"id":"g_1","why":"ir hoy"}]}'
          ),
      },
    ]);
    const { narratives, provider: by, summary } = await narrateTop(opts());
    expect(narratives.get("g_1")).toBe("ir hoy");
    expect(by).toBe("opencode-go");
    expect(summary).toBe("plan");
  });

  it("retries once when the response is unparseable", async () => {
    let calls = 0;
    mockFetch([
      {
        match: (u) => u.includes("/zen/v1/chat/completions"),
        response: () => jsonResponse({}, 429),
      },
      {
        match: (u) => u.includes("/zen/go/v1/chat/completions"),
        response: () => {
          calls++;
          return chat(calls === 1 ? "no json aquí" : '{"narratives":[{"id":"g_1","why":"ok"}]}');
        },
      },
    ]);
    const { narratives } = await narrateTop(opts());
    expect(narratives.get("g_1")).toBe("ok");
    expect(calls).toBe(2);
  });

  it("returns empty when every provider fails", async () => {
    mockFetch([{ match: urlContains("chat/completions"), response: () => jsonResponse({}, 500) }]);
    const { narratives } = await narrateTop(opts());
    expect(narratives.size).toBe(0);
  });

  it("returns empty when no provider is configured", async () => {
    delete process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_GO_API_KEY;
    const { narratives } = await narrateTop(opts());
    expect(narratives.size).toBe(0);
  });
});
