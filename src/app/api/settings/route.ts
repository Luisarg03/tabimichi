import { NextRequest, NextResponse } from "next/server";
import { configStatus, setConfig } from "@/lib/settings";
import type { AppConfig } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(configStatus());
}

export async function POST(req: NextRequest) {
  let body: Partial<AppConfig>;
  try {
    body = (await req.json()) as Partial<AppConfig>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const clean: Partial<AppConfig> = {};
  for (const k of ["googlePlacesApiKey", "opencodeApiKey", "opencodeGoApiKey"] as const) {
    if (typeof body[k] === "string") clean[k] = body[k].trim();
  }
  try {
    setConfig(clean);
    return NextResponse.json(configStatus());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
