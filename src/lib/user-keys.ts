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
  guide_model: "guideModel",
};

const EMPTY_CONFIG: AppConfig = {
  googlePlacesApiKey: "",
  opencodeApiKey: "",
  opencodeGoApiKey: "",
  geoapifyApiKey: "",
  overpassEndpoint: "",
  guideModel: "",
};

export interface UserContext {
  /** signed-in user id, or null for anonymous requests */
  userId: string | null;
  config: AppConfig;
}

/**
 * Resolve the requesting user (id + keys) from the Bearer JWT. One auth call
 * serves both — the crowd layer needs the id to read back this user's own
 * observations, and doing it here avoids a second round trip on the hot path.
 */
export async function resolveUser(req: NextRequest): Promise<UserContext> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { userId: null, config: { ...EMPTY_CONFIG } };
  const token = auth.slice(7);
  try {
    const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
    if (!user) return { userId: null, config: { ...EMPTY_CONFIG } };
    // User-scoped client; RLS restricts rows to this user
    const { data: keys } = await getSupabaseForUser(token)
      .from("api_keys")
      .select("key_name, key_value");
    const config: AppConfig = { ...EMPTY_CONFIG };
    for (const row of keys ?? []) {
      const field = USER_KEY_MAP[row.key_name];
      if (field) config[field] = row.key_value;
    }
    return { userId: user.id, config };
  } catch {
    return { userId: null, config: { ...EMPTY_CONFIG } };
  }
}

/** Resolve the requesting user's keys, or an empty config when unauthenticated. */
export async function getUserKeys(req: NextRequest): Promise<AppConfig> {
  return (await resolveUser(req)).config;
}
