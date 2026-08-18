import { NextRequest, NextResponse } from "next/server";
import { recommend } from "@/lib/recommend";
import { logEntry } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security";
import { getUserKeys } from "@/lib/user-keys";
import type { RecommendInput } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: RecommendInput;
  try {
    body = (await req.json()) as RecommendInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { lat, lng, budget, types = [], radiusKm, mode, lang, now, keyword } = body ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }
  if (!["lunch", "afternoon", "full_day"].includes(budget)) {
    return NextResponse.json({ error: "invalid budget" }, { status: 400 });
  }
  if (mode !== undefined && !["walking", "transit", "car"].includes(mode)) {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }
  if (now !== undefined && Number.isNaN(Date.parse(now))) {
    return NextResponse.json({ error: "invalid now" }, { status: 400 });
  }
  if (keyword !== undefined && (typeof keyword !== "string" || keyword.trim().length > 60)) {
    return NextResponse.json({ error: "keyword too long" }, { status: 400 });
  }

  // Cost/abuse control: discovery spends the requesting user's API quota.
  const limited = enforceRateLimit(req, "recommend", { perIp: 15, perUser: 40 });
  if (limited) return limited;

  try {
    // BYOK: this user's own API keys (empty for anonymous — no operator fallback)
    const config = await getUserKeys(req);

    const result = await recommend({
      lat,
      lng,
      budget,
      types,
      radiusKm,
      mode,
      lang: lang === "en" ? "en" : "es",
      now,
      keyword: typeof keyword === "string" ? keyword.trim() : undefined,
      config,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[tabi] /api/recommend failed:", e);
    logEntry({ type: "error", route: "recommend", error: String(e) });
    return NextResponse.json({ error: "recommendation_failed" }, { status: 502 });
  }
}
