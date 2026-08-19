import type { NextRequest } from "next/server";
import type { AppConfig } from "@/lib/settings";
import { getSupabaseAdmin, getSupabaseForUser } from "@/lib/supabase/server";

/**
 * Per-user API keys (BYOK): each user brings their own provider keys and
 * controls what they spend. Rows live in Supabase `api_keys` (RLS per user)
 * and are resolved from the request's Bearer JWT.
 *
 * Anonymous requests have NO keys — there is no operator fallback, so a
 * keyless session can never spend anyone's quota (discovery degrades to the
 * free Overpass mirrors; photos render placeholders).
 *
 * Single source of truth for the key-name mapping — shared by every route
 * that spends a user's quota (recommend, narrate, photo, photos).
 */
export const USER_KEY_MAP: Record<string, keyof AppConfig> = {
  google_places: "googlePlacesApiKey",
  geoapify: "geoapifyApiKey",
  overpass_endpoint: "overpassEndpoint",
  opencode_zen: "opencodeApiKey",
  opencode_go: "opencodeGoApiKey",
};

const EMPTY_CONFIG: AppConfig = {
  googlePlacesApiKey: "",
  opencodeApiKey: "",
  opencodeGoApiKey: "",
  geoapifyApiKey: "",
  overpassEndpoint: "",
};

/** Resolve the requesting user's keys, or an empty config when unauthenticated. */
export async function getUserKeys(req: NextRequest): Promise<AppConfig> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { ...EMPTY_CONFIG };
  const token = auth.slice(7);
  try {
    const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
    if (!user) return { ...EMPTY_CONFIG };
    // User-scoped client; RLS restricts rows to this user
    const { data: keys } = await getSupabaseForUser(token)
      .from("api_keys")
      .select("key_name, key_value");
    if (!keys || keys.length === 0) return { ...EMPTY_CONFIG };
    const config: AppConfig = { ...EMPTY_CONFIG };
    for (const row of keys) {
      const field = USER_KEY_MAP[row.key_name];
      if (field) config[field] = row.key_value;
    }
    return config;
  } catch {
    return { ...EMPTY_CONFIG };
  }
}
