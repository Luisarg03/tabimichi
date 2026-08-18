import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./server";

/**
 * Shared server-side auth helpers for the user-administration layer.
 *
 * Pattern used across routes: extract the Bearer JWT → verify it with the
 * admin (service-role) client → then operate with the *user's* JWT client so
 * RLS enforces per-user isolation. Admin-only routes additionally check the
 * caller's `profiles.role` before doing anything.
 */

/** Pull the Bearer token out of the Authorization header, if present. */
export function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/** Verify a JWT and return the auth user, or null when invalid. */
export async function verifyUser(token: string): Promise<User | null> {
  try {
    const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
    return user ?? null;
  } catch {
    return null;
  }
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

/** Resolve the caller of a request, or a 401 response. */
export async function requireUser(
  req: NextRequest
): Promise<{ user: User } | { error: NextResponse }> {
  const token = extractToken(req);
  if (!token) return { error: unauthorized() };
  const user = await verifyUser(token);
  if (!user) return { error: unauthorized() };
  return { user };
}

/** Resolve the caller and confirm they are an admin, or a 401/403 response. */
export async function requireAdmin(
  req: NextRequest
): Promise<{ user: User } | { error: NextResponse }> {
  const token = extractToken(req);
  if (!token) return { error: unauthorized() };
  const user = await verifyUser(token);
  if (!user) return { error: unauthorized() };

  // Role check runs with the service-role client (bypasses RLS — this is the
  // authoritative source, never trust a client-supplied role claim).
  const { data: profile } = await getSupabaseAdmin()
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { error: forbidden() };
  return { user };
}
