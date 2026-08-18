import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isPrivateIp,
  isPrivateIpv4,
  isPrivateIpv6,
  validateEndpoint,
  rateLimit,
  resetRateLimits,
} from "@/lib/security";

describe("isPrivateIpv4", () => {
  it("flags private and reserved ranges", () => {
    expect(isPrivateIpv4("10.0.0.1")).toBe(true); // RFC1918
    expect(isPrivateIpv4("172.16.0.1")).toBe(true);
    expect(isPrivateIpv4("172.31.255.255")).toBe(true);
    expect(isPrivateIpv4("192.168.1.1")).toBe(true);
    expect(isPrivateIpv4("127.0.0.1")).toBe(true); // loopback
    expect(isPrivateIpv4("0.0.0.0")).toBe(true);
    expect(isPrivateIpv4("169.254.169.254")).toBe(true); // cloud metadata
    expect(isPrivateIpv4("100.64.0.1")).toBe(true); // CGNAT
    expect(isPrivateIpv4("192.0.2.1")).toBe(true); // TEST-NET-1
    expect(isPrivateIpv4("224.0.0.1")).toBe(true); // multicast
    expect(isPrivateIpv4("255.255.255.255")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("1.1.1.1")).toBe(false);
    expect(isPrivateIpv4("203.0.113.5")).toBe(true); // TEST-NET-3 is not routable
    expect(isPrivateIpv4("172.32.0.1")).toBe(false); // just outside 172.16/12
  });
});

describe("isPrivateIpv6", () => {
  it("flags loopback, ULA, link-local and mapped v4", () => {
    expect(isPrivateIpv6("::1")).toBe(true);
    expect(isPrivateIpv6("::")).toBe(true);
    expect(isPrivateIpv6("fc00::1")).toBe(true); // ULA
    expect(isPrivateIpv6("fd12:3456::1")).toBe(true); // ULA
    expect(isPrivateIpv6("fe80::1")).toBe(true); // link-local
    expect(isPrivateIpv6("ff02::1")).toBe(true); // multicast
    expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true); // mapped loopback
    expect(isPrivateIpv6("::ffff:192.168.0.1")).toBe(true); // mapped private
    expect(isPrivateIpv6("2001:db8::1")).toBe(true); // documentation
  });

  it("allows public addresses", () => {
    expect(isPrivateIpv6("2001:4860:4860::8888")).toBe(false);
    expect(isPrivateIpv6("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIpv6("::ffff:8.8.8.8")).toBe(false); // mapped public
  });
});

describe("isPrivateIp", () => {
  it("handles both families and garbage", () => {
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("not-an-ip")).toBe(false);
  });
});

describe("validateEndpoint (SSRF guard, static part)", () => {
  it("accepts public https endpoints", () => {
    const r = validateEndpoint("https://overpass.example.org/api/interpreter");
    expect(r.ok).toBe(true);
  });

  it("rejects non-https schemes", () => {
    const r = validateEndpoint("http://overpass.example.org/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("https-required");
  });

  it("rejects embedded credentials", () => {
    const r = validateEndpoint("https://user:pass@overpass.example.org/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("credentials-not-allowed");
  });

  it("rejects private IP literals", () => {
    for (const bad of [
      "https://127.0.0.1:8080/api",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.1/",
      "https://192.168.1.10/",
      "https://[::1]:3000/",
    ]) {
      const r = validateEndpoint(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("private-ip");
    }
  });

  it("accepts public IP literals", () => {
    const r = validateEndpoint("https://8.8.8.8/");
    expect(r.ok).toBe(true);
  });

  it("rejects malformed URLs", () => {
    const r = validateEndpoint("not a url");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-url");
  });
});

describe("rateLimit (in-memory fixed window)", () => {
  beforeEach(() => resetRateLimits());

  it("allows requests within the budget", () => {
    expect(rateLimit("k", 3, 60_000).allowed).toBe(true);
    expect(rateLimit("k", 3, 60_000).allowed).toBe(true);
    expect(rateLimit("k", 3, 60_000).allowed).toBe(true);
  });

  it("blocks once the budget is exhausted and reports Retry-After", () => {
    rateLimit("k", 2, 60_000);
    rateLimit("k", 2, 60_000);
    const r = rateLimit("k", 2, 60_000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("keeps separate budgets per key", () => {
    rateLimit("a", 1, 60_000);
    expect(rateLimit("a", 1, 60_000).allowed).toBe(false);
    expect(rateLimit("b", 1, 60_000).allowed).toBe(true);
  });

  it("resets after the window expires", () => {
    vi.useFakeTimers();
    try {
      rateLimit("k", 1, 60_000);
      expect(rateLimit("k", 1, 60_000).allowed).toBe(false);
      vi.advanceTimersByTime(60_001);
      expect(rateLimit("k", 1, 60_000).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
