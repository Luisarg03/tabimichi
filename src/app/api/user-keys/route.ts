import { NextRequest, NextResponse } from "next/server";
import { getSupabaseForUser } from "@/lib/supabase/server";
import { extractToken, requireUser } from "@/lib/supabase/auth";
import { enforceRateLimit, validateEndpoint } from "@/lib/security";
import type { AppConfig } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * GET /api/user-keys — Get current user's API keys
 * POST /api/user-keys — Save/clear current user's API keys
 *
 * Both require a valid Supabase JWT in the Authorization header.
 * api_keys queries run with the user's JWT; RLS enforces isolation.
 * The service-role client is used only to verify the JWT.
 *
 * POST body: { <field>: "<value>" | "" } — an empty string removes the key.
 * Values are trimmed and capped at 2048 chars.
 */

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

const MAX_VALUE_LENGTH = 2048;

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const limited = enforceRateLimit(req, "user-keys", { perIp: 30, perUser: 60 });
  if (limited) return limited;

  const token = extractToken(req)!;
  try {
    const { data: keys, error } = await getSupabaseForUser(token).from("api_keys").select(
      "key_name, key_value"
    );

    if (error) {
      return NextResponse.json({ error: "could not load keys" }, { status: 500 });
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
  } catch {
    return NextResponse.json({ error: "could not load keys" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const limited = enforceRateLimit(req, "user-keys", { perIp: 30, perUser: 60 });
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const token = extractToken(req)!;
  try {
    const client = getSupabaseForUser(token);

    for (const [fieldName, rawValue] of Object.entries(body)) {
      const keyName = REVERSE_MAP[fieldName as keyof AppConfig];
      if (!keyName) continue;

      if (typeof rawValue !== "string") {
        return NextResponse.json(
          { error: `invalid value for ${fieldName}: must be a string` },
          { status: 400 }
        );
      }
      const value = rawValue.trim();
      if (value.length > MAX_VALUE_LENGTH) {
        return NextResponse.json(
          { error: `value for ${fieldName} is too long (max ${MAX_VALUE_LENGTH})` },
          { status: 400 }
        );
      }

      // The overpass endpoint is fetched server-side on the user's behalf:
      // reject anything that could target internal/private infrastructure
      // (https only, no credentials, no private IP literals). The hostname is
      // re-verified against private ranges at request time (SSRF guard).
      if (keyName === "overpass_endpoint" && value !== "") {
        const check = validateEndpoint(value);
        if (!check.ok) {
          return NextResponse.json(
            { error: `invalid overpass endpoint: ${check.reason}` },
            { status: 400 }
          );
        }
      }

      if (value === "") {
        // Empty value = remove the key.
        const { error } = await client
          .from("api_keys")
          .delete()
          .eq("user_id", auth.user.id)
          .eq("key_name", keyName);
        if (error) {
          return NextResponse.json({ error: "could not clear key" }, { status: 500 });
        }
      } else {
        const { error } = await client.from("api_keys").upsert(
          { user_id: auth.user.id, key_name: keyName, key_value: value },
          { onConflict: "user_id,key_name" }
        );
        if (error) {
          return NextResponse.json({ error: "could not save key" }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "could not save keys" }, { status: 500 });
  }
}
