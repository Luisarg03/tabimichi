import type { Place } from "../types";
import type { ExperienceType } from "./taxonomy";

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

/**
 * Optional custom Overpass instance (e.g. self-hosted osm3s in Docker).
 * When set, it is tried first; public mirrors remain as fallback.
 */
let customEndpoint: string | null = null;

export function setOverpassEndpoint(endpoint: string): void {
  customEndpoint = endpoint.trim() || null;
}

const TIMEOUT_MS = 40000;

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Build one Overpass QL query covering every tag spec of every type. */
function buildQuery(types: ExperienceType[], lat: number, lng: number, radiusM: number): string {
  const parts: string[] = [];
  for (const type of types) {
    for (const spec of type.overpass) {
      const keyExpr = spec.value.startsWith("~")
        ? `${spec.key}~"${spec.value.slice(1)}"`
        : `${spec.key}="${spec.value}"`;
      parts.push(`node(around:${radiusM},${lat},${lng})[${keyExpr}];`);
      parts.push(`way(around:${radiusM},${lat},${lng})[${keyExpr}];`);
    }
  }
  return `[out:json][timeout:25];(${parts.join("")});out center 120;`;
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

function fallbackName(typeId: string): string {
  const names: Record<string, string> = {
    onsen: "Onsen",
    temple: "Templo",
    viewpoint: "Mirador",
    food: "Restaurante",
    market: "Mercado",
    museum: "Museo",
    park: "Parque",
    trekking: "Sendero",
    sakura: "Atracción",
    shopping: "Zona de compras",
    nightlife: "Bar",
  };
  return names[typeId] ?? "Lugar";
}

/**
 * OpenStreetMap search via Overpass. Free, no key, best-effort:
 * one combined query, mirror failover with retries and timeouts.
 */
export async function overpassSearch(
  types: ExperienceType[],
  lat: number,
  lng: number,
  radiusM: number
): Promise<Place[]> {
  const valid = types.filter((t) => t.overpass.length > 0);
  if (valid.length === 0) return [];

  const query = buildQuery(valid, lat, lng, radiusM);
  let lastErr: unknown = null;

  const endpoints = customEndpoint ? [customEndpoint, ...MIRRORS] : MIRRORS;

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(
          endpoint,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              // Overpass rejects requests without a recognizable User-Agent (406)
              "User-Agent": "tabi-local/0.1 (personal travel discovery app)",
            },
            body: new URLSearchParams({ data: query }),
          },
          TIMEOUT_MS
        );
        if (!res.ok) throw new Error(`overpass-http-${res.status}`);
        const data = (await res.json()) as OverpassResponse;

        const assigned = assignTypes(data.elements, valid);
        return assigned
          .map(({ element: e, matched }): Place | null => {
            const lat2 = e.lat ?? e.center?.lat;
            const lng2 = e.lon ?? e.center?.lon;
            if (lat2 === undefined || lng2 === undefined) return null;
            const tags = e.tags ?? {};
            return {
              id: `o_${e.type}_${e.id}`,
              source: "overpass" as const,
              name:
                tags.name ||
                tags["name:en"] ||
                tags["name:ja"] ||
                `${fallbackName(matched[0])} (${e.type} ${e.id})`,
              lat: lat2,
              lng: lng2,
              tags: matched,
              openNow: null,
            } satisfies Place;
          })
          .filter((p): p is Place => p !== null);
      } catch (err) {
        lastErr = err;
        await sleep(1200 * (attempt + 1));
      }
    }
  }
  throw lastErr ?? new Error("overpass-unreachable");
}
