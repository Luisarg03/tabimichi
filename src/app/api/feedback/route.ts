import { NextRequest, NextResponse } from "next/server";
import { applyFeedback, getProfile } from "@/lib/db";

export const runtime = "nodejs";

/** GET → current profile (tag weights). */
export async function GET() {
  return NextResponse.json({ profile: getProfile() });
}

/**
 * POST { placeId, liked, tags? } → record vote + update tag weights.
 * `tags` should be the ones shown on the card (the user votes on what they
 * saw); when omitted, the cached place's tags are used.
 */
export async function POST(req: NextRequest) {
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
  try {
    const profile = applyFeedback(placeId, liked, tags);
    return NextResponse.json({ profile });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
