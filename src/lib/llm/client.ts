import type { LlmProvider } from "./providers";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** retries on transient (5xx/network) errors, default 2 */
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * OpenAI-compatible chat completion against a registry provider.
 * Defaults to the provider's first model. Retries transient gateway errors
 * (5xx/network) but fails fast on 4xx — a rate-limited free tier (429) won't
 * clear in milliseconds, so the caller should fall back to the next provider.
 */
export async function chatComplete(
  provider: LlmProvider,
  opts: ChatOptions
): Promise<string> {
  const {
    model = provider.models[0] ?? "deepseek-v4-flash",
    messages,
    maxTokens = 1024,
    temperature = 0.4,
    timeoutMs = 45000,
    retries = 2,
  } = opts;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${provider.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        // 4xx (bad key, rate limit…) won't recover on retry — fail fast
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`llm-http-${res.status}`, { cause: "fail-fast" });
        }
        throw new Error(`llm-http-${res.status}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length === 0) throw new Error("llm-empty");
      return text;
    } catch (err) {
      // 4xx won't recover on retry — fail fast so the caller can
      // fall back to the next provider immediately
      if ((err as Error)?.cause === "fail-fast") throw err;
      lastErr = err;
      if (attempt < retries) await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("llm-unreachable");
}
