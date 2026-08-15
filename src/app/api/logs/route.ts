import { NextRequest, NextResponse } from "next/server";
import { readLogTail } from "@/lib/logger";

export const runtime = "nodejs";

/** GET /api/logs?tail=50 → recent persisted request/response entries (newest first). */
export async function GET(req: NextRequest) {
  const tail = Math.min(Math.max(Number(req.nextUrl.searchParams.get("tail") ?? 50), 1), 500);
  const trace = req.nextUrl.searchParams.get("trace")?.trim() || undefined;
  return NextResponse.json({ entries: readLogTail(tail, trace) });
}
