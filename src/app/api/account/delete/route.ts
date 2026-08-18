import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";

/**
 * POST /api/account/delete — permanently delete the current user's account.
 *
 * Requires a valid Supabase JWT. The delete runs with the service-role client
 * (self-deletion is not allowed through the user-facing Auth API). All
 * per-user rows (api_keys, profiles, feedback, profile_weights) are removed by
 * the `on delete cascade` foreign keys on auth.users.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  // Destructive action: tight budget per user/IP.
  const limited = enforceRateLimit(req, "account-delete", { perIp: 10, perUser: 10 });
  if (limited) return limited;

  try {
    const { error } = await getSupabaseAdmin().auth.admin.deleteUser(auth.user.id);
    if (error) {
      return NextResponse.json({ error: "could not delete account" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "could not delete account" }, { status: 500 });
  }
}
