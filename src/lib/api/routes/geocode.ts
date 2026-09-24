import { NextRequest, NextResponse } from "next/server";
import { logEntry } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  name: string;
}

/**
 * Progressive geocoding fallbacks. Nominatim often fails on Japanese
 * addresses with block numbers ("Kitaishidocho-1373 …" → 0 results), so we
 * try progressively simpler variants until one resolves.
 */
export function geocodeVariants(q: string): string[] {
  const out = [q];

  // 1) strip block/house numbers from street tokens: "Kitaishidocho-1373" → "Kitaishidocho"
  const stripped = q
    .replace(/([A-Za-z\u3040-\u30ff\u4e00-\u9fff]+)[-\s]?\d+(-\d+)?/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (stripped && stripped !== q) out.push(stripped);

  // 1b) leading street name + the rest (drops district words that confuse
  //     Nominatim): "Kitaishidocho, Nagano, 380-0826, Japón"
  const streetMatch = q.match(/^([A-Za-z\u3040-\u30ff\u4e00-\u9fff]+)[^,]*,\s*(.+)$/);
  if (streetMatch) {
    const streetVariant = `${streetMatch[1]}, ${streetMatch[2]}`;
    if (!out.includes(streetVariant)) out.push(streetVariant);
  }

  // 2) drop the street segment (first comma part): "Nagano, 380-0826, Japón"
  const rest = q.split(",").slice(1).join(",").trim();
  if (rest) out.push(rest);

  // 3) postal code alone
  const zip = q.match(/\d{3}-\d{4}/)?.[0];
  if (zip) out.push(`${zip}, Japan`);

  // 4) last two segments (city + country) as a last resort
  const lastTwo = q.split(",").slice(-2).join(",").trim();
  if (lastTwo && lastTwo !== rest && lastTwo !== q) out.push(lastTwo);

  return [...new Set(out.filter(Boolean))];
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });

  // Free external service + per-request logging: bound anonymous abuse.
  const limited = enforceRateLimit(req, "geocode", { perIp: 30 });
  if (limited) return limited;

  const startedAt = performance.now();
  const variants = geocodeVariants(q);

  for (const variant of variants) {
    try {
      const url =
        "https://nominatim.openstreetmap.org/search?" +
        new URLSearchParams({ q: variant, format: "json", limit: "1", "accept-language": "es" });
      const res = await fetch(url, {
        headers: { "User-Agent": "tabi-local/0.1 (personal travel discovery app)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`nominatim-${res.status}`);
      const data = (await res.json()) as NominatimResult[];
      if (data.length === 0) continue;
      const r = data[0];
      logEntry({
        type: "geocode",
        query: q,
        variant,
        found: true,
        lat: Number(r.lat),
        lng: Number(r.lon),
        ms: Math.round(performance.now() - startedAt),
      });
      return NextResponse.json({
        lat: Number(r.lat),
        lng: Number(r.lon),
        name: r.display_name.split(",").slice(0, 2).join(","),
        fullName: r.display_name,
      });
    } catch (e) {
      logEntry({
        type: "geocode",
        query: q,
        variant,
        found: false,
        error: String(e),
        ms: Math.round(performance.now() - startedAt),
      });
    }
  }

  logEntry({
    type: "geocode",
    query: q,
    variants: variants.length,
    found: false,
    ms: Math.round(performance.now() - startedAt),
  });
  return NextResponse.json({ error: "not-found" }, { status: 404 });
}
