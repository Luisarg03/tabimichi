import { NextRequest, NextResponse } from "next/server";
import { EXPERIENCE_TYPE_MAP } from "@/lib/places/taxonomy";
import { getProfile, resetProfile, setProfileWeight } from "@/lib/db";
import { getSupabaseForUser } from "@/lib/supabase/server";
import { extractToken, verifyUser } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";

/**
 * "Tus gustos" management: read the learned profile, set one tag weight,
 * or reset the whole profile.
 *
 * Dual path:
 *  - signed-in user (Bearer JWT) → per-user weights in Supabase (RLS);
 *  - anonymous → local SQLite profile (dev/sandbox fallback).
 */

export async function cloudProfile(token: string): Promise<Record<string, number>> {
  const { data } = await getSupabaseForUser(token)
    .from("profile_weights")
    .select("tag, weight");
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[r.tag] = r.weight;
  return out;
}

export async function GET(req: NextRequest) {
  const limited = enforceRateLimit(req, "profile", { perIp: 60 });
  if (limited) return limited;

  const token = extractToken(req);
  if (token) {
    const user = await verifyUser(token);
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const profile = await cloudProfile(token);
    return NextResponse.json({ profile, cloud: true });
  }
  return NextResponse.json({ profile: getProfile(), cloud: false });
}

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "profile", { perIp: 60 });
  if (limited) return limited;

  let body: { tag?: unknown; weight?: unknown; reset?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const token = extractToken(req);
  const user = token ? await verifyUser(token) : null;
  if (token && !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    if (body.reset === true) {
      if (user && token) {
        await getSupabaseForUser(token)
          .from("profile_weights")
          .delete()
          .eq("user_id", user.id);
        return NextResponse.json({ profile: await cloudProfile(token), cloud: true });
      }
      return NextResponse.json({ profile: resetProfile(), cloud: false });
    }

    const tag = typeof body.tag === "string" ? body.tag : "";
    const weight = Number(body.weight);
    if (!EXPERIENCE_TYPE_MAP[tag] || !Number.isFinite(weight)) {
      return NextResponse.json({ error: "tag + numeric weight required" }, { status: 400 });
    }
    const clamped = Math.max(-5, Math.min(5, Math.round(weight)));

    if (user && token) {
      if (clamped === 0) {
        await getSupabaseForUser(token)
          .from("profile_weights")
          .delete()
          .eq("user_id", user.id)
          .eq("tag", tag);
      } else {
        await getSupabaseForUser(token)
          .from("profile_weights")
          .upsert({ user_id: user.id, tag, weight: clamped }, { onConflict: "user_id,tag" });
      }
      return NextResponse.json({ profile: await cloudProfile(token), cloud: true });
    }
    return NextResponse.json({ profile: setProfileWeight(tag, weight), cloud: false });
  } catch {
    return NextResponse.json({ error: "operation_failed" }, { status: 500 });
  }
}
