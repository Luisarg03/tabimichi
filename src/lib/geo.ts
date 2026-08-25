import type { LatLng, TransportMode } from "./types";

/** Great-circle distance in km */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Rough travel-time estimate in minutes, by transport mode, with a route
 * detour factor per mode (straight-line distance is not the road/walk/rail
 * distance: city walking detours ~25%, transit routes and transfers ~50%,
 * driving ~25%). Heuristics: walking 4.5 km/h (capped at 4h), transit
 * ~28 km/h + 8 min wait overhead, car ~40 km/h + 2 min. Fine-tuned later (M+).
 */
const DETOUR_FACTOR: Record<TransportMode, number> = { walking: 1.25, transit: 1.5, car: 1.25 };

export function travelMin(distKm: number, mode: TransportMode = "transit"): number {
  if (distKm <= 0.2) return Math.max(1, Math.round(distKm / 0.083)); // ~5 km/h walk for tiny distances
  const routeKm = distKm * DETOUR_FACTOR[mode];
  switch (mode) {
    case "walking":
      return Math.min(Math.round((routeKm / 4.5) * 60), 240);
    case "car":
      return Math.max(3, Math.round((routeKm / 40) * 60 + 2));
    default:
      return Math.max(4, Math.round((routeKm / 28) * 60 + 8));
  }
}

/** Time budget (minutes) per TimeBudget id */
export const BUDGET_MIN: Record<string, number> = {
  lunch: 90,
  afternoon: 300,
  full_day: 600,
};

/**
 * Discovery radius (km) per TimeBudget id and transport mode.
 * The base radii are tuned for transit; walking means "explore AROUND the
 * point" — a 5+ km walk is not "around me" — so walking uses explicit tight
 * radii (1.5–3.5 km ≈ 20–47 min on foot). Car extends the reach.
 */
export function radiusForBudget(budget: string, mode: TransportMode = "transit"): number {
  if (mode === "walking") {
    switch (budget) {
      case "lunch":
        return 1.5;
      case "afternoon":
        return 2.5;
      case "full_day":
        return 3.5;
      default:
        return 2;
    }
  }
  const base = (() => {
    switch (budget) {
      case "lunch":
        return 5;
      case "afternoon":
        return 12;
      case "full_day":
        return 35;
      default:
        return 8;
    }
  })();
  return mode === "car" ? base * 2 : base;
}
