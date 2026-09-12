import type { CrowdCategory } from "./curves";
import { categoryOf } from "./curves";

/**
 * How popular is this place at all? The answer for "how many people are there
 * right now" is mostly "how many people go there, times what time it is".
 *
 * Real review volume (`user_ratings_total`, the same base Google's own
 * Popular Times builds on) is the strongest free signal we have, and it is
 * already in the discovery payload. OSM/Geoapify rows carry no reviews, so
 * they fall back to a per-category pseudo-count: a temple with no data is
 * assumed to see more traffic than an unnamed viewpoint. Expressing the
 * fallback AS a review count keeps one scale for both, instead of blending
 * two incomparable scores later.
 */

/** Assumed review volume when the source reports none. */
const PSEUDO_REVIEWS: Record<CrowdCategory, number> = {
  temple: 300,
  museum: 120,
  food: 60,
  market: 100,
  shopping: 250,
  park: 150,
  sakura: 200,
  viewpoint: 80,
  trekking: 30,
  onsen: 70,
  nightlife: 40,
  other: 25,
};

/** A documented landmark (Wikipedia/Wikidata) draws beyond its review count. */
const WIKIPEDIA_BOOST = 1.3;

export interface PopularityInput {
  id: string;
  tags: string[];
  userRatingsTotal?: number;
  wikipedia?: string;
}

function rawScore(p: PopularityInput): number {
  const category = categoryOf(p.tags);
  const reviews = p.userRatingsTotal && p.userRatingsTotal > 0 ? p.userRatingsTotal : PSEUDO_REVIEWS[category];
  const boosted = p.wikipedia ? reviews * WIKIPEDIA_BOOST : reviews;
  return Math.log10(1 + boosted);
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx];
}

/**
 * Normalize the pool's raw popularity to 0..1 against its own p95 (not its
 * max): one runaway tourist magnet must not flatten every other candidate to
 * zero. The scale is therefore relative to the search area, which is exactly
 * the question being asked — "which of these is busier than which".
 */
export function popularityScores(pool: PopularityInput[]): Map<string, number> {
  const out = new Map<string, number>();
  if (pool.length === 0) return out;
  const raws = pool.map(rawScore);
  const sorted = [...raws].sort((a, b) => a - b);
  const scale = Math.max(percentile(sorted, 0.95), 0.5);
  pool.forEach((p, i) => {
    out.set(p.id, Math.min(1, Math.max(0, raws[i] / scale)));
  });
  return out;
}
