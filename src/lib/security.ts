/**
 * Shared server-side security helpers:
 *  - in-memory fixed-window rate limiting (best-effort: per-instance state —
 *    on Vercel serverless each function instance has its own counters; for a
 *    hard guarantee use a shared store such as Upstash/Vercel KV);
 *  - SSRF guard for user-supplied outbound endpoints (scheme/host/IP checks);
 *  - client IP extraction from proxy headers.
 */

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------

/** Best-effort client IP. Vercel's edge overwrites x-forwarded-for with the
 *  real client address, so the first entry is trustworthy there. Behind other
 *  proxies, configure them to overwrite XFF to prevent spoofing. */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, fixed window)
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 20_000;
const PRUNE_EVERY = 1_000;
let checks = 0;

function pruneExpired(now: number): void {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec?: number;
}

/** Fixed-window counter keyed by `key`. Returns { allowed:false } once the
 *  window budget is exhausted. Cheap and dependency-free. */
export function rateLimit(
  key: string,
  limit: number,
  windowMs = 60_000
): RateLimitResult {
  const now = Date.now();
  checks += 1;
  if (checks % PRUNE_EVERY === 0 || buckets.size > MAX_BUCKETS) {
    pruneExpired(now);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (b.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }
  b.count += 1;
  return { allowed: true };
}

/** Testability: drop all counters. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Hash a bearer token so we never keep raw JWTs in memory. */
function tokenKey(auth: string | null): string | null {
  if (!auth?.startsWith("Bearer ")) return null;
  return createHash("sha256").update(auth.slice(7)).digest("hex").slice(0, 20);
}

export interface RateLimitPolicy {
  /** max requests per window per client IP (unset = no IP limit) */
  perIp?: number;
  /** max requests per window per authenticated user (unset = no user limit) */
  perUser?: number;
  windowMs?: number;
}

/** Enforce a rate limit for a request scope; returns a 429 response when the
 *  caller exceeded the budget, else null (proceed). */
export function enforceRateLimit(
  req: NextRequest,
  scope: string,
  policy: RateLimitPolicy = {}
): NextResponse | null {
  const windowMs = policy.windowMs ?? 60_000;
  const rl = (key: string, limit: number) =>
    rateLimit(`${scope}:${key}`, limit, windowMs);

  if (policy.perIp !== undefined) {
    const res = rl(`ip:${clientIp(req)}`, policy.perIp);
    if (!res.allowed) return rateLimitedResponse(res.retryAfterSec);
  }
  if (policy.perUser !== undefined) {
    const t = tokenKey(req.headers.get("authorization"));
    if (t) {
      const res = rl(`user:${t}`, policy.perUser);
      if (!res.allowed) return rateLimitedResponse(res.retryAfterSec);
    }
  }
  return null;
}

function rateLimitedResponse(retryAfterSec?: number): NextResponse {
  return NextResponse.json(
    { error: "rate_limited" },
    {
      status: 429,
      headers: retryAfterSec ? { "Retry-After": String(retryAfterSec) } : undefined,
    }
  );
}

// ---------------------------------------------------------------------------
// SSRF guard for user-supplied endpoints
// ---------------------------------------------------------------------------

/** Reserved / non-routable IPv4 ranges that a user-supplied endpoint must
 *  never target (private nets, loopback, link-local, CGNAT, metadata
 *  169.254.169.254, multicast, reserved). */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true; // not dotted-decimal → treat as suspicious
  const [a, b] = parts.map(Number);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return true;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/** Reserved / non-routable IPv6 prefixes. */
export function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // unspecified / loopback
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 → re-check the embedded v4
    const v4 = lower.slice(7);
    const parts = v4.split(".");
    if (parts.length !== 4) return true; // hex form → treat as reserved
    return isPrivateIpv4(v4);
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
  if (lower.startsWith("fe8") || lower.startsWith("fe9") ||
      lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10 link-local
  if (lower.startsWith("ff")) return true; // ff00::/8 multicast
  if (lower.startsWith("64:ff9b")) return true; // 64:ff9b::/96 NAT64
  if (lower.startsWith("::")) return true; // ::/8 (unspecified + compat)
  if (lower.startsWith("2001:db8")) return true; // documentation range
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIpv4(ip);
  if (v === 6) return isPrivateIpv6(ip);
  return false;
}

export type EndpointCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/** Static validation of a user-supplied endpoint: https only, no embedded
 *  credentials, and — when the host is an IP literal — it must be public.
 *  Hostname resolution is checked separately by `assertResolvedPublic`. */
export function validateEndpoint(raw: string): EndpointCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "https-required" };
  if (url.username || url.password) return { ok: false, reason: "credentials-not-allowed" };
  // URL.hostname keeps the brackets on IPv6 literals ("[::1]") — strip them
  // so the address-family checks see a plain IP.
  const hostRaw = url.hostname;
  const host =
    hostRaw.startsWith("[") && hostRaw.endsWith("]")
      ? hostRaw.slice(1, -1)
      : hostRaw;
  if (host.length === 0 || host.length > 253) return { ok: false, reason: "invalid-host" };
  const v = isIP(host);
  if (v !== 0) {
    if (isPrivateIp(host)) return { ok: false, reason: "private-ip" };
    return { ok: true, url }; // public IP literal is fine
  }
  return { ok: true, url };
}

/** Resolve a user-supplied endpoint and reject it when ANY resolved address
 *  is private/reserved. Residual risk: DNS rebinding between this check and
 *  the actual fetch (mitigated by the https + SNI requirement and, on hosted
 *  runtimes, egress filtering). */
export async function assertResolvedPublic(
  raw: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const check = validateEndpoint(raw);
  if (!check.ok) return check;
  const host = check.url.hostname;
  if (isIP(host) !== 0) return { ok: true }; // literal already validated above
  try {
    const addrs = await lookup(host, { all: true, verbatim: true });
    if (addrs.length === 0) return { ok: false, reason: "dns-empty" };
    for (const a of addrs) {
      if (isPrivateIp(a.address)) return { ok: false, reason: "dns-private" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "dns-failed" };
  }
}
