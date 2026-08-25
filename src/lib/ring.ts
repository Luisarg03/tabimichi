/** Score-ring geometry: a circular progress ring drawn as an SVG circle.
 *  Pure math so the UI component stays dumb and testable. */

export const RING_RADIUS = 15.5;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Dash offset for a score in [0, 100] (clamped), so 100 = full ring. */
export function ringOffset(score: number): number {
  if (!Number.isFinite(score)) return RING_CIRCUMFERENCE;
  const s = Math.max(0, Math.min(100, score));
  return RING_CIRCUMFERENCE * (1 - s / 100);
}
