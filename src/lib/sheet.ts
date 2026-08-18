/**
 * Pure logic for the mobile results bottom sheet (Google-Maps-style).
 * The component keeps drag state; these functions decide the snap target and
 * the translateY for each snap so the math is unit-testable.
 */

export type SheetSnap = "hidden" | "peek" | "list" | "full";

export const SNAP_ORDER: SheetSnap[] = ["hidden", "peek", "list", "full"];

/** Height of the always-visible handle + summary row (px). */
export const PEEK_H = 88;

/** Fraction of the viewport covered by the "list" snap. */
export const LIST_RATIO = 0.55;

/** Fraction of the viewport covered by the "full" snap. */
export const FULL_RATIO = 0.93;

/** Distance from the top of the viewport to the sheet's top edge (px).
 *  Larger value = more closed. `hidden` sits fully below the viewport. */
export function snapTop(snap: SheetSnap, vh: number, safeBottom = 0): number {
  switch (snap) {
    case "hidden":
      return vh;
    case "peek":
      return vh - (PEEK_H + safeBottom);
    case "list":
      return vh - Math.round(vh * LIST_RATIO);
    case "full":
      return vh - Math.round(vh * FULL_RATIO);
  }
}

/** Drag threshold (px): beyond it the drag direction decides the next snap. */
const DIRECTION_THRESHOLD = 80;

/** Fling threshold (px/ms): a fast flick wins over distance. */
const FLING_THRESHOLD = 0.5;

/** Next snap after a drag of `dy` px (positive = dragged down/closing) with
 *  optional `velocity` px/ms (negative = flinging up/opening).
 *  Priority: fling > long drag > nearest snap. */
export function resolveSnap(
  from: SheetSnap,
  dy: number,
  vh: number,
  safeBottom = 0,
  velocity = 0
): SheetSnap {
  const fromIdx = SNAP_ORDER.indexOf(from);
  const tops = SNAP_ORDER.map((s) => ({ snap: s, top: snapTop(s, vh, safeBottom) }));
  const fromTop = snapTop(from, vh, safeBottom);
  const minTop = tops[tops.length - 1].top; // most open
  const maxTop = tops[0].top; // most closed

  // SNAP_ORDER goes most-closed → most-open; negative velocity/dy = opening.
  if (Math.abs(velocity) > FLING_THRESHOLD) {
    const next = fromIdx + (velocity < 0 ? 1 : -1);
    return SNAP_ORDER[Math.max(0, Math.min(SNAP_ORDER.length - 1, next))];
  }
  if (Math.abs(dy) > DIRECTION_THRESHOLD) {
    const next = fromIdx + (dy < 0 ? 1 : -1);
    return SNAP_ORDER[Math.max(0, Math.min(SNAP_ORDER.length - 1, next))];
  }
  const targetTop = Math.min(maxTop, Math.max(minTop, fromTop + dy));
  return tops.reduce((best, c) =>
    Math.abs(c.top - targetTop) < Math.abs(best.top - targetTop) ? c : best
  ).snap;
}

/** Rough drag velocity in px/ms from the last few move events. */
export function dragVelocity(samples: Array<{ t: number; y: number }>): number {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return (last.y - first.y) / dt;
}
