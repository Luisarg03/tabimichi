import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { ROUTES, match } from "./router";
import { GET, POST, PATCH, DELETE } from "@/app/api/[...path]/route";

/**
 * The catch-all replaced sixteen route files, so the router is now the only
 * thing deciding which handler runs. A wrong pattern does not fail loudly — it
 * silently sends a request to the wrong endpoint or to a 404 — so the table is
 * asserted explicitly, as a contract.
 *
 * Paths and methods are both part of the public API: the client and the route
 * tests call these exact URLs.
 */
const CONTRACT: Array<[path: string, methods: string[]]> = [
  ["account/delete", ["POST"]],
  ["admin/users/:id", ["PATCH", "DELETE"]],
  ["admin/users", ["GET"]],
  ["crowd/report", ["POST"]],
  ["feedback", ["GET", "POST"]],
  ["geocode", ["GET"]],
  ["logs", ["GET"]],
  ["me", ["GET"]],
  ["narrate", ["POST"]],
  ["photo", ["GET"]],
  ["photos", ["GET"]],
  ["profile", ["GET", "POST"]],
  ["recommend", ["POST"]],
  ["search/resolve", ["GET"]],
  ["search/suggest", ["GET"]],
  ["user-keys", ["GET", "POST"]],
];

const segments = (path: string) => path.split("/");

describe("router table", () => {
  it("declares exactly the endpoints the app serves", () => {
    expect(ROUTES.map((r) => r.path).sort()).toEqual(CONTRACT.map(([p]) => p).sort());
  });

  it("maps each path to its methods", () => {
    for (const [path, methods] of CONTRACT) {
      const hit = match(segments(path));
      expect(hit, `${path} should match`).not.toBeNull();
      expect(Object.keys(hit!.handlers).sort(), `${path} methods`).toEqual([...methods].sort());
    }
  });

  it("keeps every path reachable by the URL the client uses", () => {
    // A leading `/api/` must never end up inside the matched path.
    for (const [path] of CONTRACT) {
      expect(match(segments(path))).not.toBeNull();
    }
  });
});

describe("dynamic segments", () => {
  it("extracts the id from /api/admin/users/<id>", async () => {
    const hit = match(["admin", "users", "2f1c9d3e-0000-4000-8000-abcdefabcdef"]);
    expect(hit).not.toBeNull();
    expect(await hit!.params).toEqual({ id: "2f1c9d3e-0000-4000-8000-abcdefabcdef" });
    expect(hit!.handlers.PATCH).toBeTypeOf("function");
  });

  it("does not let the id pattern swallow the bare collection path", async () => {
    // `admin/users/:id` is listed first, so it is the one that could over-match.
    const hit = match(["admin", "users"]);
    expect(Object.keys(hit!.handlers)).toEqual(["GET"]);
    expect(await hit!.params).toEqual({});
  });

  it("decodes percent-encoded segments", async () => {
    const hit = match(["admin", "users", "a%20b"]);
    expect(await hit!.params).toEqual({ id: "a b" });
  });
});

describe("unmatched requests", () => {
  it("returns null so the caller can 404", () => {
    for (const path of [
      ["nope"],
      ["admin"],
      ["admin", "users", "a", "b"], // too deep for a single :id
      ["search"], // a prefix is not a route
      [],
    ]) {
      expect(match(path), path.join("/")).toBeNull();
    }
  });

  it("rejects an empty segment instead of matching the dynamic route", () => {
    // `/api/admin/users//x` must not resolve to id="" — the regex uses [^/]+.
    expect(match(["admin", "users", "", "x"])).toBeNull();
  });
});

describe("the catch-all route", () => {
  const call = (method: typeof GET, url: string) =>
    method(new NextRequest(url), { params: Promise.resolve({ path: new URL(url).pathname.split("/").slice(2) }) });

  it("404s an unknown path (Next used to generate this for free)", async () => {
    const res = await call(GET, "http://x/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("405s a known path with the wrong method, and advertises the allowed ones", async () => {
    const res = await call(POST, "http://x/api/photo");
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
  });

  it("lists every allowed method when a route has more than one", async () => {
    const res = await call(PATCH, "http://x/api/profile");
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")?.split(", ").sort()).toEqual(["GET", "POST"]);
  });

  it("404s a wrong method on an unknown path rather than 405", async () => {
    // Ordering: an unmatched path is a 404 even if the method is nonsense.
    const res = await call(DELETE, "http://x/api/nope");
    expect(res.status).toBe(404);
  });
});
