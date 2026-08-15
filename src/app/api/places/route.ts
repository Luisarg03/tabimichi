import { NextRequest, NextResponse } from "next/server";
import { discover } from "@/lib/places";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  const radiusKm = Math.min(Number(sp.get("radius") ?? 10), 50);
  const types = (sp.get("types") ?? "").split(",").filter(Boolean);
  const lang = sp.get("lang") === "en" ? "en" : "es";

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }
  try {
    const { places, source } = await discover({ lat, lng, radiusKm, types, lang });
    return NextResponse.json({ places, source });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
