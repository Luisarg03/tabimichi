/**
 * Static route table for the single catch-all API function.
 *
 * Vercel's Hobby plan caps a deployment at 12 Serverless Functions and Tabi had
 * 16 routes plus middleware, so the production deploy was refused. Collapsing
 * every route into `app/api/[...path]/route.ts` makes the function count a
 * constant instead of a function of how many endpoints exist — and the URLs are
 * unchanged, so the client and the tests keep working as they are.
 *
 * Handlers live in `src/lib/api/routes/`, mirroring the URL they serve, so
 * `routes/search/suggest.ts` ↔ `/api/search/suggest` needs no lookup table to
 * follow. Each one is `import()`ed per request rather than imported at the top:
 * a catch-all is one function, and a static import would pull all sixteen
 * handlers (and their dependencies) into every cold start.
 */
import type { NextRequest } from "next/server";

/**
 * Handlers keep the exact shape Next.js passed them before this refactor, so
 * none of them needed editing. That means the params type is *narrower* than
 * `Record<string, string>` in the dynamic route (`Promise<{ id: string }>`), and
 * an invariant `Handler` type would reject it. The union keeps each handler's own
 * signature honest; the caller casts once, where the match guarantees the shape.
 */
type AnyHandler = (
  req: NextRequest,
  ctx: { params: Promise<never> },
) => Promise<Response> | Response;

export interface Route {
  /** URL path without the `/api` prefix, `:name` marking a dynamic segment. */
  path: string;
  handlers: Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", () => Promise<AnyHandler>>>;
}

/**
 * Every route, ordered most-specific first so `admin/users/:id` is tested before
 * `admin/users` — `:id` would otherwise never match a bare `/api/admin/users`.
 * A test asserts each path matches exactly one entry.
 */
export const ROUTES: Route[] = [
  { path: "account/delete", handlers: { POST: async () => (await import("./routes/account/delete")).POST } },

  { path: "admin/users/:id", handlers: {
    PATCH: async () => (await import("./routes/admin/users/[id]")).PATCH,
    DELETE: async () => (await import("./routes/admin/users/[id]")).DELETE,
  } },
  { path: "admin/users", handlers: { GET: async () => (await import("./routes/admin/users")).GET } },

  { path: "crowd/report", handlers: { POST: async () => (await import("./routes/crowd/report")).POST } },

  { path: "feedback", handlers: {
    GET: async () => (await import("./routes/feedback")).GET,
    POST: async () => (await import("./routes/feedback")).POST,
  } },

  { path: "geocode", handlers: { GET: async () => (await import("./routes/geocode")).GET } },
  { path: "logs", handlers: { GET: async () => (await import("./routes/logs")).GET } },
  { path: "me", handlers: { GET: async () => (await import("./routes/me")).GET } },
  { path: "narrate", handlers: { POST: async () => (await import("./routes/narrate")).POST } },

  { path: "photo", handlers: { GET: async () => (await import("./routes/photo")).GET } },
  { path: "photos", handlers: { GET: async () => (await import("./routes/photos")).GET } },

  { path: "profile", handlers: {
    GET: async () => (await import("./routes/profile")).GET,
    POST: async () => (await import("./routes/profile")).POST,
  } },

  { path: "recommend", handlers: { POST: async () => (await import("./routes/recommend")).POST } },
  { path: "search/resolve", handlers: { GET: async () => (await import("./routes/search/resolve")).GET } },
  { path: "search/suggest", handlers: { GET: async () => (await import("./routes/search/suggest")).GET } },

  { path: "user-keys", handlers: {
    GET: async () => (await import("./routes/user-keys")).GET,
    POST: async () => (await import("./routes/user-keys")).POST,
  } },
];

const CACHE = new Map<string, { re: RegExp; names: string[] }>();

/** Compile `admin/users/:id` into a matcher that captures the dynamic parts. */
function compile(path: string) {
  let compiled = CACHE.get(path);
  if (!compiled) {
    const names: string[] = [];
    const source = path
      .split("/")
      .map((seg) => {
        if (!seg.startsWith(":")) return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(seg.slice(1));
        // One segment: no `/`, and non-empty so `/api/admin/users//x` cannot match.
        return "([^/]+)";
      })
      .join("/");
    compiled = { re: new RegExp(`^${source}$`), names };
    CACHE.set(path, compiled);
  }
  return compiled;
}

export interface Match {
  handlers: Route["handlers"];
  params: Promise<Record<string, string>>;
}

/**
 * Resolve a path segment list (the catch-all `path` param) to its handlers.
 * Returns `null` when nothing matches, which the caller turns into a 404.
 */
export function match(segments: string[]): Match | null {
  // Percent-encoded values (an id, a name) arrive encoded in the raw path.
  const pathname = segments.map((s) => decodeURIComponent(s)).join("/");

  for (const route of ROUTES) {
    const { re, names } = compile(route.path);
    const hit = re.exec(pathname);
    if (!hit) continue;

    const values: Record<string, string> = {};
    names.forEach((name, i) => {
      values[name] = hit[i + 1];
    });
    return { handlers: route.handlers, params: Promise.resolve(values) };
  }
  return null;
}
