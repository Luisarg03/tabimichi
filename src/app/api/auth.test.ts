import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for the user-administration API layer: /api/me, /api/user-keys,
 * /api/account/delete, /api/admin/users (+[id]), and the cloud path of
 * /api/profile and /api/feedback — all with @/lib/supabase/server mocked.
 */

const state = vi.hoisted(() => ({
  tokenUser: null as null | {
    id: string;
    email: string;
    created_at: string;
    last_sign_in_at: string | null;
  },
  profiles: [] as Array<{ id: string; role: string; display_name: string }>,
  listUsers: [] as Array<Record<string, unknown>>,
  listNextPage: null as number | null,
  weights: [] as Array<{ tag: string; weight: number }>,
  keys: [] as Array<{ key_name: string; key_value: string }>,
  upserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  deletedCalls: [] as Array<{ table: string; id: string }>,
  adminDeleteCalls: [] as string[],
  banCalls: [] as Array<{ id: string; opts: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/server", () => {
  // Build a chainable PostgREST-like query. `await query.select(...)` resolves
  // to { data, error } (via `then`), and `.eq()/.in()/.maybeSingle()` chain.
  function q(data: unknown, table: string) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      maybeSingle: async () => ({
        data: Array.isArray(data) ? data[0] ?? null : data,
        error: null,
      }),
      single: async () => ({
        data: Array.isArray(data) ? data[0] ?? null : data,
        error: null,
      }),
      in: () => chain,
      eq: () => chain,
      upsert: async (row: Record<string, unknown>) => {
        state.upserted.push(row);
        const arr = data as Array<Record<string, unknown>>;
        if (Array.isArray(arr)) {
          if (table === "profile_weights" || table === "api_keys") {
            const key =
              table === "profile_weights"
                ? "tag"
                : (row as { key_name?: string }).key_name;
            const i = arr.findIndex((r) => r[key as string] === row[key as string]);
            if (i >= 0) arr[i] = { ...arr[i], ...row };
            else arr.push(row as never);
          }
        }
        return { data: null, error: null };
      },
      insert: async (row: Record<string, unknown>) => {
        state.upserted.push(row);
        return { data: null, error: null };
      },
      update: (row: Record<string, unknown>) => {
        state.updated.push(row);
        return chain;
      },
      delete: () => {
        state.deletedCalls.push({ table, id: "?" });
        return chain;
      },
    };
    chain.then = (resolve: (v: unknown) => void) =>
      resolve({ data: Array.isArray(data) ? data : (data ?? []), error: null });
    return chain;
  }

  return {
    getSupabaseAdmin: () => ({
      auth: {
        getUser: async () =>
          state.tokenUser
            ? { data: { user: state.tokenUser }, error: null }
            : { data: { user: null }, error: { message: "invalid token" } },
        admin: {
          listUsers: async () => ({
            data: { users: state.listUsers, nextPage: state.listNextPage },
            error: null,
          }),
          updateUserById: async (id: string, opts: Record<string, unknown>) => {
            state.banCalls.push({ id, opts });
            return { data: { user: {} }, error: null };
          },
          deleteUser: async (id: string) => {
            state.adminDeleteCalls.push(id);
            return { data: { user: {} }, error: null };
          },
        },
      },
      from: (table: string) => {
        if (table === "profiles") return q(state.profiles, table);
        if (table === "profile_weights") return q(state.weights, table);
        return q(state.keys, table);
      },
    }),
    getSupabaseForUser: () => ({
      from: (table: string) => {
        if (table === "profiles") return q(state.profiles, table);
        if (table === "profile_weights") return q(state.weights, table);
        return q(state.keys, table);
      },
    }),
  };
});

import { GET as meGET } from "@/app/api/me/route";
import { GET as userKeysGET, POST as userKeysPOST } from "@/app/api/user-keys/route";
import { GET as adminUsersGET } from "@/app/api/admin/users/route";
import {
  PATCH as adminUserPATCH,
  DELETE as adminUserDELETE,
} from "@/app/api/admin/users/[id]/route";
import { POST as accountDeletePOST } from "@/app/api/account/delete/route";
import { GET as profileGET, POST as profilePOST } from "@/app/api/profile/route";
import { GET as feedbackGET, POST as feedbackPOST } from "@/app/api/feedback/route";

function req(
  url: string,
  { method = "GET", token, body }: { method?: string; token?: string; body?: unknown } = {}
): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  state.tokenUser = { id: "u1", email: "admin@test.dev", created_at: "2026-01-01", last_sign_in_at: "2026-08-01" };
  state.profiles = [{ id: "u1", role: "admin", display_name: "Boss" }];
  state.listUsers = [];
  state.listNextPage = null;
  state.weights = [];
  state.keys = [];
  state.upserted = [];
  state.updated = [];
  state.deletedCalls = [];
  state.adminDeleteCalls = [];
  state.banCalls = [];
});

describe("/api/me", () => {
  it("rejects missing tokens", async () => {
    const res = await meGET(req("http://localhost/api/me"));
    expect(res.status).toBe(401);
  });

  it("returns the user + profile for a valid token", async () => {
    const res = await meGET(req("http://localhost/api/me", { token: "tok" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { email: string };
      profile: { display_name: string; role: string };
    };
    expect(body.user.email).toBe("admin@test.dev");
    expect(body.profile.role).toBe("admin");
  });
});

describe("/api/user-keys", () => {
  it("reads keys into the AppConfig shape", async () => {
    state.keys = [
      { key_name: "google_places", key_value: "AIza-123" },
      { key_name: "opencode_go", key_value: "sk-go" },
    ];
    const res = await userKeysGET(req("http://localhost/api/user-keys", { token: "tok" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: Record<string, string> };
    expect(body.config.googlePlacesApiKey).toBe("AIza-123");
    expect(body.config.opencodeGoApiKey).toBe("sk-go");
  });

  it("trims and upserts values", async () => {
    const res = await userKeysPOST(
      req("http://localhost/api/user-keys", {
        method: "POST",
        token: "tok",
        body: { googlePlacesApiKey: "  AIza-abc  " },
      })
    );
    expect(res.status).toBe(200);
    expect(state.upserted).toContainEqual({
      user_id: "u1",
      key_name: "google_places",
      key_value: "AIza-abc",
    });
  });

  it("rejects non-string values", async () => {
    const res = await userKeysPOST(
      req("http://localhost/api/user-keys", {
        method: "POST",
        token: "tok",
        body: { googlePlacesApiKey: 123 },
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects values over the length cap", async () => {
    const res = await userKeysPOST(
      req("http://localhost/api/user-keys", {
        method: "POST",
        token: "tok",
        body: { googlePlacesApiKey: "x".repeat(3000) },
      })
    );
    expect(res.status).toBe(400);
  });

  it("deletes the row when the value is empty", async () => {
    const res = await userKeysPOST(
      req("http://localhost/api/user-keys", {
        method: "POST",
        token: "tok",
        body: { googlePlacesApiKey: "" },
      })
    );
    expect(res.status).toBe(200);
    expect(state.deletedCalls).toHaveLength(1);
    expect(state.upserted).toHaveLength(0);
  });

  it("rejects requests without a token", async () => {
    const res = await userKeysGET(req("http://localhost/api/user-keys"));
    expect(res.status).toBe(401);
  });
});

describe("/api/account/delete", () => {
  it("deletes the current user via the admin API", async () => {
    const res = await accountDeletePOST(
      req("http://localhost/api/account/delete", { method: "POST", token: "tok" })
    );
    expect(res.status).toBe(200);
    expect(state.adminDeleteCalls).toEqual(["u1"]);
  });

  it("rejects without a token", async () => {
    const res = await accountDeletePOST(req("http://localhost/api/account/delete", { method: "POST" }));
    expect(res.status).toBe(401);
  });
});

describe("/api/admin/users", () => {
  it("lists users merged with their profiles for admins", async () => {
    state.listUsers = [
      { id: "u2", email: "user@test.dev", created_at: "2026-02-01", last_sign_in_at: null, email_confirmed_at: "2026-02-02" },
    ];
    state.profiles = [
      { id: "u1", role: "admin", display_name: "Boss" },
      { id: "u2", role: "user", display_name: "User" },
    ];
    const res = await adminUsersGET(req("http://localhost/api/admin/users", { token: "tok" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<{ email: string; role: string; display_name: string }> };
    expect(body.users).toHaveLength(1);
    expect(body.users[0].email).toBe("user@test.dev");
    expect(body.users[0].role).toBe("user");
    expect(body.users[0].display_name).toBe("User");
  });

  it("forbids non-admins", async () => {
    state.profiles = [{ id: "u1", role: "user", display_name: "Boss" }];
    const res = await adminUsersGET(req("http://localhost/api/admin/users", { token: "tok" }));
    expect(res.status).toBe(403);
  });

  it("rejects anonymous requests", async () => {
    state.tokenUser = null;
    const res = await adminUsersGET(req("http://localhost/api/admin/users"));
    expect(res.status).toBe(401);
  });
});

describe("/api/admin/users/[id]", () => {
  it("changes a user's role", async () => {
    const res = await adminUserPATCH(
      req("http://localhost/api/admin/users/u2", { method: "PATCH", token: "tok", body: { action: "set_role", role: "admin" } }),
      { params: Promise.resolve({ id: "u2" }) }
    );
    expect(res.status).toBe(200);
    expect(state.updated).toContainEqual(expect.objectContaining({ role: "admin" }));
  });

  it("validates the role value", async () => {
    const res = await adminUserPATCH(
      req("http://localhost/api/admin/users/u2", { method: "PATCH", token: "tok", body: { action: "set_role", role: "superadmin" } }),
      { params: Promise.resolve({ id: "u2" }) }
    );
    expect(res.status).toBe(400);
  });

  it("bans and unbans", async () => {
    await adminUserPATCH(
      req("http://localhost/api/admin/users/u2", { method: "PATCH", token: "tok", body: { action: "ban" } }),
      { params: Promise.resolve({ id: "u2" }) }
    );
    expect(state.banCalls).toContainEqual({ id: "u2", opts: { ban_duration: "8760h" } });
    await adminUserPATCH(
      req("http://localhost/api/admin/users/u2", { method: "PATCH", token: "tok", body: { action: "unban" } }),
      { params: Promise.resolve({ id: "u2" }) }
    );
    expect(state.banCalls).toContainEqual({ id: "u2", opts: { ban_duration: "none" } });
  });

  it("refuses to act on yourself", async () => {
    const res = await adminUserPATCH(
      req("http://localhost/api/admin/users/u1", { method: "PATCH", token: "tok", body: { action: "ban" } }),
      { params: Promise.resolve({ id: "u1" }) }
    );
    expect(res.status).toBe(400);
    expect(state.banCalls).toHaveLength(0);
  });

  it("deletes a user (not yourself)", async () => {
    const res = await adminUserDELETE(
      req("http://localhost/api/admin/users/u2", { method: "DELETE", token: "tok" }),
      { params: Promise.resolve({ id: "u2" }) }
    );
    expect(res.status).toBe(200);
    expect(state.adminDeleteCalls).toEqual(["u2"]);
  });
});

describe("/api/profile (cloud path)", () => {
  it("reads per-user weights with a token", async () => {
    state.weights = [{ tag: "onsen", weight: 2 }];
    const res = await profileGET(req("http://localhost/api/profile", { token: "tok" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: Record<string, number>; cloud: boolean };
    expect(body.profile).toEqual({ onsen: 2 });
    expect(body.cloud).toBe(true);
  });

  it("sets a weight with a token", async () => {
    const res = await profilePOST(
      req("http://localhost/api/profile", { method: "POST", token: "tok", body: { tag: "food", weight: 3 } })
    );
    expect(res.status).toBe(200);
    expect(state.upserted).toContainEqual({
      user_id: "u1",
      tag: "food",
      weight: 3,
    });
  });

  it("resets weights with a token", async () => {
    state.weights = [{ tag: "onsen", weight: 2 }];
    const res = await profilePOST(
      req("http://localhost/api/profile", { method: "POST", token: "tok", body: { reset: true } })
    );
    expect(res.status).toBe(200);
    expect(state.deletedCalls.length).toBeGreaterThan(0);
  });
});

describe("/api/feedback (cloud path)", () => {
  it("records a vote and nudges weights with a token", async () => {
    state.weights = [{ tag: "onsen", weight: 1 }];
    const res = await feedbackPOST(
      req("http://localhost/api/feedback", {
        method: "POST",
        token: "tok",
        body: { placeId: "g_1", liked: true, tags: ["onsen"] },
      })
    );
    expect(res.status).toBe(200);
    // feedback row inserted
    expect(state.upserted).toContainEqual(
      expect.objectContaining({ user_id: "u1", place_id: "g_1", liked: true })
    );
    // weight upserted to 2
    expect(state.upserted).toContainEqual(
      expect.objectContaining({ user_id: "u1", tag: "onsen", weight: 2 })
    );
  });

  it("still reads the local profile when anonymous", async () => {
    state.tokenUser = null;
    const res = await feedbackGET(req("http://localhost/api/feedback"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: Record<string, number>; cloud: boolean };
    expect(body.cloud).toBe(false);
  });
});
