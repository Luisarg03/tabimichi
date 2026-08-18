/**
 * In-memory fake of the Supabase admin client used by src/lib/cache.ts.
 * Plain object factory (no vi.mock hoisting games): tests install it via
 * `setAdminForTests(() => fake)` and read `places`/`storage` to assert state.
 */
export function makeSupabaseFake() {
  const places = new Map<string, Record<string, unknown>>();
  const storage = new Map<string, Uint8Array>();

  interface Filters {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    since: string | null;
    id: string | null;
    descending: boolean;
    limit: number;
    update: Record<string, unknown> | null;
  }

  function runQuery(table: string, f: Filters): Record<string, unknown>[] {
    const rows = [...places.values()].filter((r) => {
      if (f.id !== null && r.id !== f.id) return false;
      if (Number(r.lat) < f.minLat || Number(r.lat) > f.maxLat) return false;
      if (Number(r.lng) < f.minLng || Number(r.lng) > f.maxLng) return false;
      if (f.since !== null && String(r.fetched_at) < f.since) return false;
      return true;
    });
    if (f.update) {
      for (const r of rows) Object.assign(r, f.update);
      return rows;
    }
    rows.sort((a, b) => String(a.fetched_at).localeCompare(String(b.fetched_at)));
    if (f.descending) rows.reverse();
    return rows.slice(0, f.limit);
  }

  function query(table: string, updateObj: Record<string, unknown> | null = null) {
    const f: Filters = {
      minLat: -Infinity,
      maxLat: Infinity,
      minLng: -Infinity,
      maxLng: Infinity,
      since: null,
      id: null,
      descending: false,
      limit: 1000,
      update: updateObj,
    };
    const api = {
      select: () => api,
      gte: (col: string, v: number | string) => {
        if (col === "lat") f.minLat = v as number;
        if (col === "lng") f.minLng = v as number;
        if (col === "fetched_at") f.since = v as string;
        return api;
      },
      lte: (col: string, v: number | string) => {
        if (col === "lat") f.maxLat = v as number;
        if (col === "lng") f.maxLng = v as number;
        return api;
      },
      eq: (col: string, v: unknown) => {
        if (col === "id") f.id = v as string;
        return api;
      },
      order: (_col: string, opts: { ascending: boolean }) => {
        f.descending = !opts.ascending;
        return api;
      },
      limit: (n: number) => {
        f.limit = n;
        return api;
      },
      maybeSingle: async () => ({
        data: runQuery(table, f)[0] ?? null,
        error: null,
      }),
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: runQuery(table, f), error: null }),
    };
    return api;
  }

  return {
    places,
    storage,
    fake: {
      from: (table: string) => ({
        upsert: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          for (const r of Array.isArray(rows) ? rows : [rows]) places.set(String(r.id), { ...r });
          return { error: null };
        },
        select: () => query(table),
        update: (obj: Record<string, unknown>) => query(table, obj),
      }),
      storage: {
        from: () => ({
          download: async (key: string) => {
            const bytes = storage.get(key);
            return bytes
              ? { data: new Blob([bytes.buffer as ArrayBuffer]), error: null }
              : { data: null, error: { message: "not found" } };
          },
          upload: async (key: string, body: Uint8Array) => {
            storage.set(key, body);
            return { error: null };
          },
        }),
      },
    },
  };
}
