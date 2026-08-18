import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";

export const runtime = "nodejs";

const MAX_PER_PAGE = 100;

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw ? parseInt(raw, 10) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * GET /api/admin/users?page=1&perPage=25&q=email@…
 *
 * Admin-only: list auth users (from the Admin API) merged with their profile
 * row (role + display name). `q` filters by email substring (server-side).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  const sp = req.nextUrl.searchParams;
  const page = clampInt(sp.get("page"), 1, 1, 1_000_000);
  const perPage = clampInt(sp.get("perPage"), 25, 1, MAX_PER_PAGE);
  const filter = sp.get("q")?.trim() || undefined;

  try {
    const admin = getSupabaseAdmin();
    // This supabase-js version has no server-side filter for listUsers, so a
    // search pulls a wider page and filters by email here (fine for a small
    // user base; the UI resets to page 1 on every search).
    const { data, error } = await admin.auth.admin.listUsers({
      page: filter ? 1 : page,
      perPage: filter ? 100 : perPage,
    });
    if (error) {
      return NextResponse.json({ error: "could not list users" }, { status: 500 });
    }
    let users = data.users;
    if (filter) {
      users = users.filter((u) =>
        (u.email ?? "").toLowerCase().includes(filter.toLowerCase())
      );
    }

    // Merge profile rows (role/display_name) for every listed user.
    const profileMap: Record<string, { role: string; display_name: string }> = {};
    if (users.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, role, display_name")
        .in(
          "id",
          users.map((u) => u.id)
        );
      for (const p of profiles ?? []) {
        profileMap[p.id] = { role: p.role, display_name: p.display_name };
      }
    }

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        display_name: profileMap[u.id]?.display_name ?? "",
        role: profileMap[u.id]?.role ?? "user",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        banned_until: u.banned_until ?? null,
        confirmed: Boolean(u.email_confirmed_at),
      })),
      page,
      perPage,
      nextPage: filter ? null : data.nextPage ?? null,
    });
  } catch {
    return NextResponse.json({ error: "could not list users" }, { status: 500 });
  }
}
