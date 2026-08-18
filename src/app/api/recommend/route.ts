import { NextRequest, NextResponse } from "next/server";
import { recommend } from "@/lib/recommend";
import { logEntry } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security";
import type { AppConfig } from "@/lib/settings";
import { getSupabaseAdmin, getSupabaseForUser } from "@/lib/supabase/server";
import type { RecommendInput } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Get API keys for the current user from Supabase.
 * api_keys queries run with the user's JWT; RLS enforces isolation.
 * Falls back to env vars if no user is authenticated.
 * Returns whether the config came from user rows (`fromUserKeys`) so the
 * caller can treat user-supplied endpoints as untrusted (SSRF check).
 */
async function getKeysForRequest(
  req: NextRequest
): Promise<{ config: AppConfig; fromUserKeys: boolean }> {
  // Try to get user keys from Supabase
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    try {
      const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
      if (user) {
        const { data: keys } = await getSupabaseForUser(token)
          .from("api_keys")
          .select("key_name, key_value");

        if (keys && keys.length > 0) {
          const KEY_MAP: Record<string, keyof AppConfig> = {
            google_places: "googlePlacesApiKey",
            geoapify: "geoapifyApiKey",
            overpass_endpoint: "overpassEndpoint",
            opencode_zen: "opencodeApiKey",
            opencode_go: "opencodeGoApiKey",
          };
          const config: AppConfig = {
            googlePlacesApiKey: "",
            opencodeApiKey: "",
            opencodeGoApiKey: "",
            geoapifyApiKey: "",
            overpassEndpoint: "",
          };
          for (const row of keys) {
            const field = KEY_MAP[row.key_name];
            if (field) config[field] = row.key_value;
          }
          return { config, fromUserKeys: true };
        }
      }
    } catch {
      // Fall through to default config
    }
  }

  // Fallback to env vars
  const { getConfig } = await import("@/lib/settings");
  return { config: getConfig(), fromUserKeys: false };
}

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

  // Cost/abuse control: this endpoint spends the operator's API quota when no
  // user keys are configured — bound it per IP and per authenticated user.
  const limited = enforceRateLimit(req, "recommend", { perIp: 15, perUser: 40 });
  if (limited) return limited;

  try {
    // Get user-specific API keys (no process.env mutation!)
    const { config: keys, fromUserKeys } = await getKeysForRequest(req);

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
      config: keys,
      trustedEndpoint: !fromUserKeys,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[tabi] /api/recommend failed:", e);
    logEntry({ type: "error", route: "recommend", error: String(e) });
    return NextResponse.json({ error: "recommendation_failed" }, { status: 502 });
  }
}
