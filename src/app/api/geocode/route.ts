import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  name: string;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });

  try {
    const url =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({ q, format: "json", limit: "1", "accept-language": "es" });
    const res = await fetch(url, {
      headers: { "User-Agent": "tabi-local/0.1 (personal travel discovery app)" },
    });
    if (!res.ok) throw new Error(`nominatim-${res.status}`);
    const data = (await res.json()) as NominatimResult[];
    if (data.length === 0) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    const r = data[0];
    return NextResponse.json({
      lat: Number(r.lat),
      lng: Number(r.lon),
      name: r.display_name.split(",").slice(0, 2).join(","),
      fullName: r.display_name,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
