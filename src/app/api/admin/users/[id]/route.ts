import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";

export const runtime = "nodejs";

/**
 * Admin-only per-user actions.
 *
 * PATCH /api/admin/users/:id
 *   { action: "set_role", role: "user" | "admin" }  → change profile role
 *   { action: "ban" }                               → suspend (1 year)
 *   { action: "unban" }                             → lift suspension
 *
 * DELETE /api/admin/users/:id → permanently delete the user
 *   (all per-user rows are removed via FK cascade on auth.users)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (id === auth.user.id) {
    return NextResponse.json({ error: "cannot modify your own account here" }, { status: 400 });
  }

  let body: { action?: unknown; role?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();

    if (body.action === "set_role") {
      const role = body.role;
      if (role !== "user" && role !== "admin") {
        return NextResponse.json({ error: "role must be 'user' or 'admin'" }, { status: 400 });
      }
      const { error } = await admin
        .from("profiles")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        return NextResponse.json({ error: "could not update role" }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "ban" || body.action === "unban") {
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: body.action === "ban" ? "8760h" : "none",
      });
      if (error) {
        return NextResponse.json({ error: "could not update ban status" }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "could not update user" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (id === auth.user.id) {
    return NextResponse.json({ error: "cannot delete your own account here" }, { status: 400 });
  }

  try {
    const { error } = await getSupabaseAdmin().auth.admin.deleteUser(id, false);
    if (error) {
      return NextResponse.json({ error: "could not delete user" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "could not delete user" }, { status: 500 });
  }
}
