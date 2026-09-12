import { getSupabaseAdmin } from "../supabase/server";
import { addLocalCrowdReport, getLocalCrowdReports } from "../db";
import { LEARNED_MAX_AGE_MS, type CrowdReport } from "./reports";

/**
 * Persistence for crowd observations.
 *
 * Reports live in Supabase when there is a user (RLS: own rows only) and in
 * the local SQLite store otherwise — the same split `feedback` uses. Reads
 * merge BOTH stores, so observations made anonymously before signing in still
 * count. Every failure degrades to "no observations": a store hiccup must
 * never break a recommendation.
 */

const REPORT_TABLE = "crowd_reports";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;
let adminFactory: () => AdminClient = getSupabaseAdmin;

/** Test seam — same pattern as cache.setAdminForTests. */
export function setAdminForTests(fn: () => AdminClient): void {
  adminFactory = fn;
}

interface ReportRow {
  place_id: string;
  level: number;
  reported_at: string;
  local_hour: number;
  weekend: boolean;
}

function rowToReport(r: ReportRow): CrowdReport {
  const lvl = r.level === 0 || r.level === 1 || r.level === 2 ? r.level : 1;
  return {
    placeId: r.place_id,
    level: lvl,
    at: Date.parse(r.reported_at),
    localHour: Number(r.local_hour ?? 12),
    weekend: r.weekend === true,
  };
}

/**
 * Reports for these places from the last 60 days, grouped by place.
 * `userId` = the signed-in user whose reports should be folded in.
 */
export async function readCrowdReports(
  placeIds: string[],
  userId: string | null
): Promise<Map<string, CrowdReport[]>> {
  const out = new Map<string, CrowdReport[]>();
  if (placeIds.length === 0) return out;
  const sinceMs = Date.now() - LEARNED_MAX_AGE_MS;

  const push = (r: CrowdReport) => {
    const list = out.get(r.placeId);
    if (list) list.push(r);
    else out.set(r.placeId, [r]);
  };

  for (const r of getLocalCrowdReports(placeIds, sinceMs)) push(r);

  if (userId) {
    try {
      const { data, error } = await adminFactory()
        .from(REPORT_TABLE)
        .select("place_id,level,reported_at,local_hour,weekend")
        .eq("user_id", userId)
        .in("place_id", placeIds)
        .gte("reported_at", new Date(sinceMs).toISOString())
        .order("reported_at", { ascending: false })
        .limit(500);
      if (error) console.warn(`[tabi] crowd_reports read failed: ${error.message}`);
      for (const row of (data as ReportRow[] | null) ?? []) push(rowToReport(row));
    } catch (e) {
      console.warn(`[tabi] crowd_reports read failed: ${String(e)}`);
    }
  }
  return out;
}

/** Store one observation. Supabase for signed-in users, SQLite otherwise. */
export async function persistCrowdReport(report: CrowdReport, userId: string | null): Promise<void> {
  if (!userId) {
    addLocalCrowdReport(report);
    return;
  }
  try {
    const { error } = await adminFactory().from(REPORT_TABLE).insert({
      place_id: report.placeId,
      user_id: userId,
      level: report.level,
      reported_at: new Date(report.at).toISOString(),
      local_hour: report.localHour,
      weekend: report.weekend,
    });
    if (error) console.warn(`[tabi] crowd_reports insert failed: ${error.message}`);
  } catch (e) {
    console.warn(`[tabi] crowd_reports insert failed: ${String(e)}`);
  }
}
