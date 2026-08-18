import { NextRequest, NextResponse } from "next/server";
import { applyFeedback, getProfile, placeById } from "@/lib/db";
import { getSupabaseForUser } from "@/lib/supabase/server";
import { extractToken, verifyUser } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/security";
import { cloudProfile } from "@/app/api/profile/route";

export const runtime = "nodejs";

/**
 * 👍 / 👎 feedback on a place → updates the tag weights.
 *
 * Dual path (same as /api/profile):
 *  - signed-in user → per-user rows in Supabase (RLS);
 *  - anonymous → local SQLite (dev/sandbox fallback).
 */

/** Record a vote in Supabase: insert the feedback row, then nudge each tag's
 *  weight by ±1 (clamped to [-5, 5]). */
async function cloudApplyFeedback(
  token: string,
  userId: string,
  placeId: string,
  liked: boolean,
  tags?: string[]
): Promise<Record<string, number>> {
  const client = getSupabaseForUser(token);
  const resolvedTags =
    tags && tags.length > 0 ? tags : (placeById(placeId)?.tags ?? []);

  const { error: insErr } = await client.from("feedback").insert({
    user_id: userId,
    place_id: placeId,
    liked,
    tags: resolvedTags.length > 0 ? resolvedTags : null,
  });
  if (insErr) throw insErr;

  const delta = liked ? 1 : -1;
  const { data: rows } = await client
    .from("profile_weights")
    .select("tag, weight")
    .in("tag", resolvedTags);
  const current: Record<string, number> = {};
  for (const r of rows ?? []) current[r.tag] = r.weight;

  for (const tag of resolvedTags) {
    const next = Math.max(-5, Math.min(5, (current[tag] ?? 0) + delta));
    if (next === 0) {
      await client
        .from("profile_weights")
        .delete()
        .eq("user_id", userId)
        .eq("tag", tag);
    } else {
      await client
        .from("profile_weights")
        .upsert({ user_id: userId, tag, weight: next }, { onConflict: "user_id,tag" });
    }
  }
  return cloudProfile(token);
}

/** GET → current profile (tag weights). */
export async function GET(req: NextRequest) {
  const limited = enforceRateLimit(req, "feedback", { perIp: 60 });
  if (limited) return limited;

  const token = extractToken(req);
  if (token) {
    const user = await verifyUser(token);
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ profile: await cloudProfile(token), cloud: true });
  }
  return NextResponse.json({ profile: getProfile(), cloud: false });
}

/**
 * POST { placeId, liked, tags? } → record vote + update tag weights.
 * `tags` should be the ones shown on the card (the user votes on what they
 * saw); when omitted, the cached place's tags are used.
 */
export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "feedback", { perIp: 60 });
  if (limited) return limited;

  let body: { placeId?: string; liked?: boolean; tags?: string[] };
  try {
    body = (await req.json()) as { placeId?: string; liked?: boolean; tags?: string[] };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { placeId, liked, tags } = body ?? {};
  if (typeof placeId !== "string" || placeId.length === 0 || typeof liked !== "boolean") {
    return NextResponse.json({ error: "placeId + liked required" }, { status: 400 });
  }

  const token = extractToken(req);
  const user = token ? await verifyUser(token) : null;
  if (token && !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    if (user && token) {
      const profile = await cloudApplyFeedback(token, user.id, placeId, liked, tags);
      return NextResponse.json({ profile, cloud: true });
    }
    const profile = applyFeedback(placeId, liked, tags);
    return NextResponse.json({ profile, cloud: false });
  } catch {
    return NextResponse.json({ error: "operation_failed" }, { status: 500 });
  }
}
