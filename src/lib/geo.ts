import type { LatLng } from "./types";

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
 * Rough travel-time estimate in minutes.
 * Walk under 3 km, otherwise assume local transit (~30 km/h average).
 * Heuristic only — refined later (M+).
 */
export function travelMin(distKm: number): number {
  if (distKm <= 0.2) return Math.max(1, Math.round(distKm / 0.083)); // ~5 km/h walk for tiny distances
  if (distKm < 3) return Math.round((distKm / 4.5) * 60); // walking 4.5 km/h
  return Math.round((distKm / 30) * 60); // transit
}

/** Time budget (minutes) per TimeBudget id */
export const BUDGET_MIN: Record<string, number> = {
  lunch: 90,
  afternoon: 300,
  full_day: 600,
};

/** Discovery radius (km) per TimeBudget id */
export function radiusForBudget(budget: string): number {
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
}
