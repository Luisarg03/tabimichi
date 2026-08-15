import { vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setDataDir } from "@/lib/db";
import { setConfigPath } from "@/lib/settings";

export type Route = {
  match: (url: string) => boolean;
  response: (url: string, init?: RequestInit) => Response;
};

/** Stub global fetch with a route table; unmatched URLs get a 500. */
export function mockFetch(routes: Route[]) {
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    for (const r of routes) {
      if (r.match(u)) return r.response(u, init);
    }
    return new Response(JSON.stringify({ error: `unexpected fetch: ${u}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function urlContains(part: string) {
  return (url: string) => url.includes(part);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function imageResponse(bytes: number[], status = 200): Response {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { "Content-Type": "image/jpeg" },
  });
}

/** Fresh temp dir + isolated DB/config for a test; returns the dir. */
export function isolatedStore(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tabi-test-"));
  process.env.TABI_DATA_DIR = dir;
  setDataDir(dir);
  setConfigPath(path.join(dir, "config.json"));
  return dir;
}
