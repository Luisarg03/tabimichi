import { NextRequest, NextResponse } from "next/server";
import { readLogTail } from "@/lib/logger";
import { requireAdmin } from "@/lib/supabase/auth";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";

/**
 * GET /api/logs?tail=50 → recent persisted request/response entries (newest first).
 *
 * Admin-only: persisted logs contain user search queries and coordinates, so
 * they must not be readable by anonymous callers.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  const limited = enforceRateLimit(req, "logs", { perIp: 30, perUser: 60 });
  if (limited) return limited;

  const tail = Math.min(Math.max(Number(req.nextUrl.searchParams.get("tail") ?? 50), 1), 500);
  const trace = req.nextUrl.searchParams.get("trace")?.trim() || undefined;
  return NextResponse.json({ entries: readLogTail(tail, trace) });
}
