import type { Place } from "../types";
import type { ExperienceType } from "./taxonomy";
import { assertResolvedPublic } from "../security";

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

const MIRRORS = [
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export { MIRRORS };

/** hard ceiling for the whole Overpass attempt — never let the fallback hang */
// Kept under typical serverless function timeouts (Vercel ~30s): a keyless
// discovery must complete (slowly) instead of hitting FUNCTION_INVOCATION_TIMEOUT.
export const TOTAL_BUDGET_MS = 20000;

/**
 * Supplementary budget used when Google/Geoapify already produced volume:
 * Overpass is the "find everything" add-on in that case, so it gets a shorter
 * ceiling and the request stays fast for keyed users.
 */
export const SUPPLEMENTARY_BUDGET_MS = 12000;

/** Per-type output cap. A single global `out center N` lets one voluminous
 *  type (food in a dense city) eat the whole budget and starve every other
 *  type — capping per type guarantees a broad pool instead. */
const PER_TYPE_OUT = 250;

/**
 * Optional custom Overpass instance (e.g. self-hosted osm3s in Docker).
 * When set, it is tried first; public mirrors remain as fallback.
 *
 * The endpoint travels as an explicit per-request option (never module state),
 * so concurrent requests from different users cannot leak configuration into
 * each other. Every custom endpoint is user-supplied (BYOK), so it is always
 * SSRF-checked before use — there is no trusted operator path.
 */
export interface OverpassOptions {
  endpoint?: string;
  /** hard ceiling for this attempt (defaults to TOTAL_BUDGET_MS); keyed
   *  discovery already has Google volume, so callers pass a shorter
   *  supplementary budget for the Overpass add-on. */
  budgetMs?: number;
}

const TIMEOUT_MS = 40000;

/**
 * Build one Overpass QL query covering every tag spec of every type.
 * Each type gets its own named set + `out` with PER_TYPE_OUT, so one type's
 * volume cannot starve the others (a global cap would let food eat it all).
 */
function buildQuery(types: ExperienceType[], lat: number, lng: number, radiusM: number): string {
  const groups = types.map((type, i) => {
    const specs = type.overpass
      .map((spec) => {
        const keyExpr = spec.value.startsWith("~")
          ? `${spec.key}~"${spec.value.slice(1)}"`
          : `${spec.key}="${spec.value}"`;
        return `node(around:${radiusM},${lat},${lng})[${keyExpr}];way(around:${radiusM},${lat},${lng})[${keyExpr}];`;
      })
      .join("");
    return `(${specs})->.t${i};.t${i} out center ${PER_TYPE_OUT};`;
  });
  return `[out:json][timeout:25];${groups.join("")}`;
}

/** Assign experience type ids by matching each element's tags against the specs. */
function assignTypes(
  elements: OverpassElement[],
  types: ExperienceType[]
): Array<{ element: OverpassElement; matched: string[] }> {
  const specsByKey = new Map<string, string[]>(); // `key=value` (or `key=~regex`) → type ids
  for (const t of types) {
    for (const s of t.overpass) {
      const k = `${s.key}=${s.value}`;
      specsByKey.set(k, [...(specsByKey.get(k) ?? []), t.id]);
    }
  }
  const out: Array<{ element: OverpassElement; matched: string[] }> = [];
  for (const e of elements) {
    const tags = e.tags ?? {};
    const matched = new Set<string>();
    for (const [specKey, typeIds] of specsByKey) {
      const eq = specKey.indexOf("=");
      const key = specKey.slice(0, eq);
      const value = specKey.slice(eq + 1);
      if (value.startsWith("~")) {
        try {
          if (new RegExp(value.slice(1)).test(tags[key] ?? "")) {
            for (const id of typeIds) matched.add(id);
          }
        } catch {
          // bad regex — skip
        }
      } else if (tags[key] === value) {
        for (const id of typeIds) matched.add(id);
      }
    }
    if (matched.size > 0) out.push({ element: e, matched: [...matched] });
  }
  return out;
}

function toPlace(e: OverpassElement, matched: string[]): Place | null {
  const lat2 = e.lat ?? e.center?.lat;
  const lng2 = e.lon ?? e.center?.lon;
  if (lat2 === undefined || lng2 === undefined) return null;
  const tags = e.tags ?? {};
  const name = tags.name || tags["name:en"] || tags["name:ja"];
  // Nameless OSM elements are bare coordinates, not places — without a name
  // they show up as anonymous pins ("Parque (way 123)") with no photos that
  // just drop a coordinate into Google Maps. The user wants real options.
  if (!name) return null;
  return {
    id: `o_${e.type}_${e.id}`,
    source: "overpass" as const,
    name,
    lat: lat2,
    lng: lng2,
    tags: matched,
    openNow: null,
  } satisfies Place;
}

/**
 * OpenStreetMap search via Overpass. Free, no key, best-effort:
 * one combined query, ALL mirrors raced concurrently — the first mirror that
 * answers with matching elements wins, so a couple of dead/overloaded mirrors
 * can no longer burn the whole budget (sequential failover with retries let
 * one hanging mirror eat 15+ s before reaching a working one).
 */
export async function overpassSearch(
  types: ExperienceType[],
  lat: number,
  lng: number,
  radiusM: number,
  opts: OverpassOptions = {}
): Promise<Place[]> {
  const valid = types.filter((t) => t.overpass.length > 0);
  if (valid.length === 0) return [];

  const query = buildQuery(valid, lat, lng, radiusM);
  const totalBudget = opts.budgetMs ?? TOTAL_BUDGET_MS;
  const startedAt = Date.now();

  let endpoints: string[] = MIRRORS;
  if (opts.endpoint) {
    // User-supplied (BYOK): reject private/reserved targets (SSRF guard).
    // On any guard failure we skip the custom endpoint and fall back to the
    // public mirrors instead of failing the whole discovery.
    const check = await assertResolvedPublic(opts.endpoint);
    if (check.ok) {
      endpoints = [opts.endpoint, ...MIRRORS];
    } else {
      console.warn(`[tabi] overpass endpoint rejected (${check.reason}), using mirrors`);
    }
  }

  // Each mirror races with its own timeout (shrunk to the remaining budget, so
  // an in-flight request can never blow past the total). Rejections are how a
  // loser exits the race: HTTP errors, timeouts, or "200 but zero matches"
  // (thin mirrors like osm.ch for Asia answer valid-but-empty).
  const attempts = endpoints.map(async (endpoint): Promise<Place[]> => {
    const remaining = totalBudget - (Date.now() - startedAt);
    if (remaining <= 0) throw new Error("overpass-budget");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Overpass rejects requests without a recognizable User-Agent (406)
        "User-Agent": "tabi-local/0.1 (personal travel discovery app)",
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, remaining)),
    });
    if (!res.ok) throw new Error(`overpass-http-${res.status}`);
    const data = (await res.json()) as OverpassResponse;

    const assigned = assignTypes(data.elements, valid);
    // A mirror that answers 200 with zero matching elements usually has
    // stale/partial coverage — it loses the race so a data-bearing mirror
    // can still win.
    if (assigned.length === 0) throw new Error("overpass-empty");
    return assigned.map(({ element: e, matched }) => toPlace(e, matched)).filter((p): p is Place => p !== null);
  });

  try {
    return await Promise.any(attempts);
  } catch (agg) {
    const reasons = (agg as AggregateError).errors ?? [];
    // Every mirror exhausted. One that answered valid-but-empty means "nothing
    // matches here" (return []); total unreachability is an error (throw →
    // callers fall back to the cache).
    if (reasons.some((e) => (e as Error)?.message === "overpass-empty")) return [];
    throw (reasons[0] as Error) ?? new Error("overpass-unreachable");
  }
}
