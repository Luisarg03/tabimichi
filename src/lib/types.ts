/** Shared types for Tabi */

export interface LatLng {
  lat: number;
  lng: number;
}

export type PlaceSource = "google" | "geoapify" | "overpass";

export interface Place {
  id: string;
  source: PlaceSource;
  name: string;
  lat: number;
  lng: number;
  /** normalized experience tags, e.g. ["onsen", "viewpoint"] */
  tags: string[];
  rating?: number;
  /** how many Google users rated it — popularity panorama (display only) */
  userRatingsTotal?: number;
  priceLevel?: number;
  openNow?: boolean | null;
  address?: string;
  /** first photo reference (convenience) */
  photoRef?: string;
  /** up to 5 photo references for the gallery */
  photoRefs?: string[];
  url?: string;
}

export type TimeBudget = "lunch" | "afternoon" | "full_day";

/** How the user will get around — changes radius, times and reasons. */
export type TransportMode = "walking" | "transit" | "car";

export type WeatherCondition = "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm";

export interface WeatherInfo {
  tempC: number;
  feelsC: number;
  precipMm: number;
  snowCm: number;
  windKmh: number;
  code: number;
  label: string;
  condition: WeatherCondition;
  isNight: boolean;
  hourly: Array<{
    time: string;
    tempC: number;
    precipProb: number;
    precipMm: number;
    snowCm: number;
    code: number;
  }>;
  daily: Array<{
    date: string;
    code: number;
    maxC: number;
    minC: number;
    precipProbMax: number;
  }>;
}

export interface Reason {
  key: string;
  params?: Record<string, string | number>;
}

export interface ScoredPlace extends Place {
  score: number;
  distanceKm: number;
  travelMin: number;
  reasons: Reason[];
  /** LLM narrative "why now" (M2) — optional, rule reasons are the fallback */
  why?: string;
}

export interface RecommendInput {
  lat: number;
  lng: number;
  budget: TimeBudget;
  types: string[]; // empty = any
  radiusKm?: number;
  mode?: TransportMode;
  /** UI language for discovery: "es" | "en" */
  lang?: string;
  /** ISO instant — when set, the pipeline simulates this time (JST evaluation) */
  now?: string;
}

/** Input for the async LLM narrative phase (/api/narrate). */
export interface NarratePlaceInput {
  id: string;
  name: string;
  distanceKm: number;
  travelMin: number;
  rating?: number;
  tags: string[];
}

export interface NarrateResponse {
  summary?: string;
  narratives: Record<string, string>;
  narratedBy?: string;
}

/** User profile: learned tag weights from 👍/👎 feedback (M3). */
export type PlaceProfile = Record<string, number>;

/** Why the recommendation list came back empty — drives the UI message. */
export type EmptyReason = "no_results" | "all_closed" | "too_far";

export interface RecommendResult {
  weather: WeatherInfo;
  places: ScoredPlace[];
  generatedAt: string;
  radiusKm: number;
  sourceNote: "google" | "geoapify" | "overpass" | "cache" | "none";
  /** whether an LLM narrative was attached (provider configured) */
  narrated: boolean;
  /** which provider tier narrated: "opencode-zen" (free) | "opencode-go" (paid) */
  narratedBy?: string;
  /** LLM day-plan summary (2-3 sentences) */
  summary?: string;
  /** why places came back empty, when they did */
  emptyReason?: EmptyReason;
  /** dev trace id correlating this request with its narrate/photos phases */
  traceId?: string;
}
