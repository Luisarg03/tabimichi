import { NextRequest, NextResponse } from "next/server";
import { getWeather } from "@/lib/weather";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }
  try {
    const weather = await getWeather(lat, lng);
    return NextResponse.json(weather);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
