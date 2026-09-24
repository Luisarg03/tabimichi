import { NextRequest, NextResponse } from "next/server";
import { getSupabaseForUser } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";

/**
 * GET /api/me — current user + profile (display name, role).
 * Requires a valid Supabase JWT in the Authorization header.
 * The profile row is read with the user's JWT; RLS restricts it to the owner.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { user, token } = auth;

  const limited = enforceRateLimit(req, "me", { perIp: 60, perUser: 120 });
  if (limited) return limited;

  // The id filter is REQUIRED, not redundant with RLS: the policy also lets an
  // admin read every profile, so without it `maybeSingle()` would see many rows,
  // error out, and the route would report the fallback role "user" — which hid
  // the admin console from the very accounts meant to use it.
  const { data: profile } = await getSupabaseForUser(token)
    .from("profiles")
    .select("display_name, role")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
    },
    profile: profile
      ? { display_name: profile.display_name, role: profile.role }
      : { display_name: "", role: "user" },
  });
}
