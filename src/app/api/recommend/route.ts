import { NextRequest, NextResponse } from "next/server";
import { recommend } from "@/lib/recommend";
import { logEntry } from "@/lib/logger";
import type { AppConfig } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { RecommendInput } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Get API keys for the current user from Supabase.
 * Falls back to env vars / config file if no user is authenticated.
 */
async function getKeysForRequest(req: NextRequest): Promise<AppConfig> {
  // Try to get user keys from Supabase
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    try {
      const admin = getSupabaseAdmin();
      const { data: { user } } = await admin.auth.getUser(token);
      if (user) {
        const { data: keys } = await admin
          .from("api_keys")
          .select("key_name, key_value")
          .eq("user_id", user.id);

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
          return config;
        }
      }
    } catch {
      // Fall through to default config
    }
  }

  // Fallback to env vars / config file
  const { getConfig } = await import("@/lib/settings");
  return getConfig();
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

  try {
    // Get user-specific API keys (no process.env mutation!)
    const keys = await getKeysForRequest(req);

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
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[tabi] /api/recommend failed:", e);
    logEntry({ type: "error", route: "recommend", error: String(e) });
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
