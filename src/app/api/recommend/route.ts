import { NextRequest, NextResponse } from "next/server";
import { recommend } from "@/lib/recommend";
import type { RecommendInput } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: RecommendInput;
  try {
    body = (await req.json()) as RecommendInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { lat, lng, budget, types = [], radiusKm, mode, lang } = body ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }
  if (!["lunch", "afternoon", "full_day"].includes(budget)) {
    return NextResponse.json({ error: "invalid budget" }, { status: 400 });
  }
  if (mode !== undefined && !["walking", "transit", "car"].includes(mode)) {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }

  try {
    const result = await recommend({
      lat,
      lng,
      budget,
      types,
      radiusKm,
      mode,
      lang: lang === "en" ? "en" : "es",
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
