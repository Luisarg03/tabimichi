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
  /** retries on 5xx/network errors, default 2 */
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * OpenAI-compatible chat completion against a registry provider.
 * Retries on transient gateway errors (the opencode gateway is
 * occasionally flaky — 5xx/network — and recovers on retry).
 */
export async function chatComplete(
  provider: LlmProvider,
  opts: ChatOptions
): Promise<string> {
  const {
    model = "deepseek-v4-flash",
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
      if (!res.ok) throw new Error(`llm-http-${res.status}`);

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length === 0) throw new Error("llm-empty");
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("llm-unreachable");
}
