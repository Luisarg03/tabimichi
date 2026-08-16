import { NextRequest, NextResponse } from "next/server";
import { EXPERIENCE_TYPE_MAP } from "@/lib/places/taxonomy";
import { getProfile, resetProfile, setProfileWeight } from "@/lib/db";

export const runtime = "nodejs";

/**
 * "Tus gustos" management: read the learned profile, set one tag weight,
 * or reset the whole profile. The profile also grows from 👍/👎 votes —
 * this route lets the user steer it directly.
 */
export async function GET() {
  return NextResponse.json({ profile: getProfile() });
}

export async function POST(req: NextRequest) {
  let body: { tag?: unknown; weight?: unknown; reset?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.reset === true) {
    return NextResponse.json({ profile: resetProfile() });
  }

  const tag = typeof body.tag === "string" ? body.tag : "";
  const weight = Number(body.weight);
  if (!EXPERIENCE_TYPE_MAP[tag] || !Number.isFinite(weight)) {
    return NextResponse.json({ error: "tag + numeric weight required" }, { status: 400 });
  }
  return NextResponse.json({ profile: setProfileWeight(tag, weight) });
}
