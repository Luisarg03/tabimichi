import { NextRequest, NextResponse } from "next/server";
import { getSupabaseForUser } from "@/lib/supabase/server";
import { extractToken, verifyUser } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";

/**
 * GET /api/me — current user + profile (display name, role).
 * Requires a valid Supabase JWT in the Authorization header.
 * The profile row is read with the user's JWT; RLS restricts it to the owner.
 */
export async function GET(req: NextRequest) {
  const token = extractToken(req);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limited = enforceRateLimit(req, "me", { perIp: 60, perUser: 120 });
  if (limited) return limited;

  const user = await verifyUser(token);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await getSupabaseForUser(token)
    .from("profiles")
    .select("display_name, role")
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
