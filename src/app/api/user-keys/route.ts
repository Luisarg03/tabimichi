import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AppConfig } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * GET /api/user-keys — Get current user's API keys
 * POST /api/user-keys — Save current user's API keys
 *
 * Both require a valid Supabase JWT in the Authorization header.
 * RLS ensures users can only access their own keys.
 */

function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

const KEY_MAP: Record<string, keyof AppConfig> = {
  google_places: "googlePlacesApiKey",
  geoapify: "geoapifyApiKey",
  overpass_endpoint: "overpassEndpoint",
  opencode_zen: "opencodeApiKey",
  opencode_go: "opencodeGoApiKey",
};

const REVERSE_MAP: Record<keyof AppConfig, string> = {
  googlePlacesApiKey: "google_places",
  geoapifyApiKey: "geoapify",
  overpassEndpoint: "overpass_endpoint",
  opencodeApiKey: "opencode_zen",
  opencodeGoApiKey: "opencode_go",
};

export async function GET(req: NextRequest) {
  const token = extractToken(req);
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const admin = getSupabaseAdmin();

    // Verify the JWT and get user
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Query with user's JWT for RLS
    const { data: keys, error } = await admin
      .from("api_keys")
      .select("key_name, key_value")
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Convert to AppConfig format
    const config: Partial<AppConfig> = {};
    for (const row of keys ?? []) {
      const fieldName = KEY_MAP[row.key_name];
      if (fieldName) {
        config[fieldName] = row.key_value;
      }
    }

    return NextResponse.json({ config });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = extractToken(req);
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Partial<AppConfig>;
  try {
    body = (await req.json()) as Partial<AppConfig>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();

    // Verify the JWT and get user
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Upsert each key
    for (const [fieldName, value] of Object.entries(body)) {
      const keyName = REVERSE_MAP[fieldName as keyof AppConfig];
      if (!keyName) continue;

      const { error } = await admin
        .from("api_keys")
        .upsert(
          { user_id: user.id, key_name: keyName, key_value: value ?? "" },
          { onConflict: "user_id,key_name" }
        );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
