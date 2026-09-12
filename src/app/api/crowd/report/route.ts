import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/user-keys";
import { persistCrowdReport } from "@/lib/crowd/store";
import { isInJapan, isJapaneseHoliday } from "@/lib/crowd/holidays";
import { localTimeAt } from "@/lib/jst";
import { enforceRateLimit } from "@/lib/security";
import { logEntry } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST { placeId, level, lat?, lng? } — "así está de lleno acá ahora".
 *
 * One tap on the ground is the only real observation the app can get for
 * free, and it is what turns the crowd estimate from a guess into a fact for
 * that place. Stored per user (Supabase with RLS, or local SQLite when
 * anonymous) and folded back in by /api/recommend.
 *
 * `level`: 0 = vacío, 1 = normal, 2 = lleno.
 */
export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "crowd-report", { perIp: 30, perUser: 60 });
  if (limited) return limited;

  let body: { placeId?: string; level?: number; lat?: number; lng?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { placeId, level, lat, lng } = body ?? {};
  if (typeof placeId !== "string" || placeId.length === 0 || placeId.length > 120) {
    return NextResponse.json({ error: "placeId required" }, { status: 400 });
  }
  if (level !== 0 && level !== 1 && level !== 2) {
    return NextResponse.json({ error: "level must be 0, 1 or 2" }, { status: 400 });
  }
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  if ((lat !== undefined && !Number.isFinite(lat)) || (lng !== undefined && !Number.isFinite(lng))) {
    return NextResponse.json({ error: "invalid coords" }, { status: 400 });
  }

  const { userId } = await resolveUser(req);

  // The reporter is standing in the place, so the observation's local
  // hour/weekday come from the destination (longitude-shifted), never from
  // server time — Vercel runs in UTC.
  const local = hasCoords ? localTimeAt(new Date(), lng as number) : new Date();
  const dow = local.getUTCDay();
  const weekend =
    dow === 0 ||
    dow === 6 ||
    (hasCoords && isInJapan(lat as number, lng as number) && isJapaneseHoliday(local));

  await persistCrowdReport(
    {
      placeId,
      level,
      at: Date.now(),
      localHour: local.getUTCHours() + local.getUTCMinutes() / 60,
      weekend,
    },
    userId
  );

  logEntry({ type: "crowd-report", placeId, level, weekend, cloud: Boolean(userId) });
  return NextResponse.json({ ok: true, cloud: Boolean(userId) });
}
