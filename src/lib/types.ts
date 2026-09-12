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
  /** OSM `wikipedia`/`wikidata` tag (page title or Q-id) — landmark signal */
  wikipedia?: string;
  url?: string;
  /** true when this candidate came from the keyword text query (in-memory only) */
  fromKeyword?: boolean;
  /** normalized keyword this row was discovered for (cache provenance only —
   *  set by discover() when writing to place_cache, never by a source) */
  keywordKey?: string;
}

/** What a search suggestion resolves to: a POI, a street address, or a city. */
export type SuggestionKind = "place" | "address" | "city";

/** Where a search suggestion came from (display/telemetry only). */
export type SuggestionSource = "cache" | "photon" | "nominatim" | "google";

/** One result of /api/search/suggest — unified shape across local + remote sources. */
export interface SearchSuggestion {
  /** stable id: `p_<source>_<placeId>` for places, hash-based for addresses */
  id: string;
  kind: SuggestionKind;
  name: string;
  /** secondary line: address, type label or city/country */
  sublabel?: string;
  /** Google predictions carry no coordinates — resolved on pick via
   *  /api/search/resolve; every other source has them. */
  lat?: number;
  lng?: number;
  /** Google place id (autocomplete prediction) — resolves coordinates on pick */
  placeId?: string;
  /** experience type id when the source category maps to the taxonomy */
  typeId?: string;
  source: SuggestionSource;
  /** distance (km) to the search bias point, when one was provided */
  distanceKm?: number;
  /** provider's own relevance index (0 = best) — tiebreak for exact matches
   *  and the only signal for cross-script matches (romaji ↔ kanji) */
  remoteRank?: number;
  rating?: number;
  userRatingsTotal?: number;
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
    /** destination-local ISO sunrise/sunset ("2026-08-20T05:10") — golden hour */
    sunrise: string;
    sunset: string;
  }>;
}

export interface Reason {
  key: string;
  params?: Record<string, string | number>;
}

/** Bucketed crowd level shown to the user. */
export type CrowdLabel = "low" | "medium" | "high" | "veryHigh";

/** Where a crowd value came from: the model, the user's observations, or both. */
export type CrowdSource = "model" | "mixed" | "observed";

/**
 * "How many people are there right now", for one place.
 * Always an ESTIMATE unless `source` is "observed"/"mixed" — the UI says which.
 */
export interface CrowdEstimate {
  /** 0..1 on the relative crowd scale */
  level: number;
  label: CrowdLabel;
  source: CrowdSource;
  /** ISO instant of the freshest own observation folded in */
  observedAt?: string;
  /** i18n keys (`crowd.factor.*`) explaining the value */
  factors: string[];
  /** destination-local hour with the fewest people left today */
  bestHour?: number;
}

export interface ScoredPlace extends Place {
  score: number;
  distanceKm: number;
  travelMin: number;
  reasons: Reason[];
  /** LLM narrative "why now" (M2) — optional, rule reasons are the fallback */
  why?: string;
  /** how busy it is right now (estimate, or observed when reported) */
  crowd?: CrowdEstimate;
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
  /** Optional interest keyword: "pokemon", "book off", "gatos"… */
  keyword?: string;
  /** The exact place the user searched (from a suggestion pick): guaranteed
   *  to appear — and rank first — even when no source knows it. */
  pin?: { name: string; lat: number; lng: number; typeId?: string };
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
  /** model id that narrated, when one ran (e.g. "deepseek-v4-pro") */
  model?: string;
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
  /** every source that contributed to this result (merged discovery), in
   *  priority order — the UI shows a combined label when there is more than one */
  sources?: Array<"google" | "geoapify" | "overpass" | "cache">;
  /** whether an LLM narrative was attached (provider configured) */
  narrated: boolean;
  /** which provider tier narrated: "opencode-zen" (free) | "opencode-go" (paid) */
  narratedBy?: string;
  /** model id that narrated (e.g. "deepseek-v4-pro"), when one ran */
  model?: string;
  /** LLM day-plan summary (2-3 sentences) */
  summary?: string;
  /** why places came back empty, when they did */
  emptyReason?: EmptyReason;
  /** dev trace id correlating this request with its narrate/photos phases */
  traceId?: string;
  /** interest keyword echoed back (UI shows the miss note with it) */
  keyword?: string;
  /** how many candidates came from the keyword query itself */
  keywordResults?: number;
  /** true when the keyword found nothing and the pool is generic */
  keywordMiss?: boolean;
  /** zone-level crowd layer [lat, lng, weight 0..1] for the map heat overlay */
  crowdCells?: Array<[number, number, number]>;
  /** ISO instant the crowd field was computed for */
  crowdAt?: string;
}
