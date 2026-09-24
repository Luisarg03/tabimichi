/**
 * The single API function.
 *
 * Vercel counts route files, and the Hobby plan allows 12 per deployment while
 * Tabi had 16 routes plus middleware — which is why the production deploy was
 * refused. Every endpoint now lives behind this catch-all, so the count is 2
 * (this + `proxy.ts`) no matter how many endpoints the app grows.
 *
 * URLs are untouched: `/api/search/suggest`, `/api/photo`, `/api/admin/users/…`
 * all still resolve exactly as before, which is what keeps the client and the
 * existing tests valid.
 */
import { NextRequest, NextResponse } from "next/server";
import { match } from "@/lib/api/router";

export const runtime = "nodejs";
/**
 * The highest any route needed was 60 (`photo`, `photos`, `recommend`,
 * `narrate`) and a function has one ceiling, so the slowest route sets it for
 * all. Vercel bills executed time, not the ceiling, so this costs nothing.
 */
export const maxDuration = 60;

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Ctx = { params: Promise<{ path: string[] }> };

function dispatch(method: Method) {
  return async (req: NextRequest, ctx: Ctx) => {
    const { path } = await ctx.params;
    const hit = match(path ?? []);

    // Explicit 404/405: Next generated these for free when each route was its
    // own file, and dropping them would change the contract for unknown paths.
    if (!hit) return NextResponse.json({ error: "not found" }, { status: 404 });

    const load = hit.handlers[method];
    if (!load) {
      return NextResponse.json(
        { error: "method not allowed" },
        { status: 405, headers: { Allow: Object.keys(hit.handlers).join(", ") } },
      );
    }

    const handler = await load();
    // The match already proved which route this is, so the handler's own params
    // shape is the right one; the cast is only undoing the union in `Route`.
    return (handler as (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>)(
      req,
      { params: hit.params },
    );
  };
}

export const GET = dispatch("GET");
export const POST = dispatch("POST");
export const PATCH = dispatch("PATCH");
export const DELETE = dispatch("DELETE");
