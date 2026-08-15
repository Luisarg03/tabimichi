/**
 * Taxonomy of experience types → discovery queries.
 * This is the vocabulary of the discovery engine, not a hardcoded
 * list of places. Each type knows how to ask Google Places and
 * OpenStreetMap Overpass for candidates.
 */

export interface OverpassSpec {
  key: string;
  value: string;
}

export interface ExperienceType {
  id: string;
  /** i18n key under `panel.type.<id>` */
  labelKey: string;
  /** Google Places text-search query term */
  googleQuery: string;
  /** Google Places nearby-search types (secondary) */
  googleTypes?: string[];
  overpass: OverpassSpec[];
  /** weather affinity */
  indoor?: boolean;
  outdoor?: boolean;
  /** emoji for map pins / chips */
  emoji: string;
}

export const EXPERIENCE_TYPES: ExperienceType[] = [
  {
    id: "onsen",
    labelKey: "onsen",
    googleQuery: "onsen 温泉 public bath",
    googleTypes: ["spa"],
    overpass: [
      { key: "leisure", value: "hot_spring" },
      { key: "amenity", value: "public_bath" },
      // many Japanese onsens are named 温泉 regardless of tag
      { key: "name", value: "~温泉" },
    ],
    indoor: true,
    emoji: "♨️",
  },
  {
    id: "temple",
    labelKey: "temple",
    googleQuery: "temple shrine",
    googleTypes: ["hindu_temple", "church"],
    overpass: [
      { key: "historic", value: "temple" },
      { key: "historic", value: "shrine" },
      { key: "amenity", value: "place_of_worship" },
    ],
    outdoor: true,
    emoji: "⛩️",
  },
  {
    id: "viewpoint",
    labelKey: "viewpoint",
    googleQuery: "viewpoint observation deck scenic spot",
    googleTypes: ["tourist_attraction"],
    overpass: [
      { key: "tourism", value: "viewpoint" },
      { key: "natural", value: "peak" },
    ],
    outdoor: true,
    emoji: "🗻",
  },
  {
    id: "food",
    labelKey: "food",
    googleQuery: "local food restaurant",
    googleTypes: ["restaurant", "food"],
    overpass: [
      { key: "amenity", value: "restaurant" },
      { key: "amenity", value: "food_court" },
      { key: "amenity", value: "fast_food" },
    ],
    indoor: true,
    emoji: "🍜",
  },
  {
    id: "market",
    labelKey: "market",
    googleQuery: "market street food market",
    googleTypes: ["supermarket", "shopping_mall"],
    overpass: [
      { key: "amenity", value: "marketplace" },
      { key: "shop", value: "supermarket" },
      { key: "shop", value: "farm" },
    ],
    indoor: true,
    emoji: "🏮",
  },
  {
    id: "museum",
    labelKey: "museum",
    googleQuery: "museum",
    googleTypes: ["museum"],
    overpass: [{ key: "tourism", value: "museum" }],
    indoor: true,
    emoji: "🏛️",
  },
  {
    id: "park",
    labelKey: "park",
    googleQuery: "park garden",
    googleTypes: ["park"],
    overpass: [
      { key: "leisure", value: "park" },
      { key: "leisure", value: "garden" },
    ],
    outdoor: true,
    emoji: "🌳",
  },
  {
    id: "trekking",
    labelKey: "trekking",
    googleQuery: "hiking trail nature walk",
    googleTypes: ["tourist_attraction", "natural_feature"],
    overpass: [
      { key: "tourism", value: "viewpoint" },
      { key: "leisure", value: "nature_reserve" },
      { key: "natural", value: "peak" },
    ],
    outdoor: true,
    emoji: "🥾",
  },
  {
    id: "sakura",
    labelKey: "sakura",
    googleQuery: "sakura hanami cherry blossom spot",
    googleTypes: ["park", "tourist_attraction"],
    overpass: [{ key: "tourism", value: "attraction" }],
    outdoor: true,
    emoji: "🌸",
  },
  {
    id: "shopping",
    labelKey: "shopping",
    googleQuery: "shopping street local shops",
    googleTypes: ["shopping_mall", "clothing_store", "department_store"],
    overpass: [
      { key: "highway", value: "pedestrian" },
      { key: "shop", value: "department_store" },
    ],
    indoor: true,
    emoji: "🛍️",
  },
  {
    id: "nightlife",
    labelKey: "nightlife",
    googleQuery: "bar izakaya nightlife",
    googleTypes: ["bar", "night_club"],
    overpass: [
      { key: "amenity", value: "bar" },
      { key: "amenity", value: "nightclub" },
    ],
    indoor: true,
    emoji: "🍻",
  },
];

export const EXPERIENCE_TYPE_MAP: Record<string, ExperienceType> = Object.fromEntries(
  EXPERIENCE_TYPES.map((t) => [t.id, t])
);

/** Default set of types used when the user picks "any". */
export const DEFAULT_TYPES = ["viewpoint", "temple", "park", "food", "museum"];

export function resolveTypes(ids: string[]): ExperienceType[] {
  if (!ids || ids.length === 0) return DEFAULT_TYPES.map((id) => EXPERIENCE_TYPE_MAP[id]);
  const out = ids
    .map((id) => EXPERIENCE_TYPE_MAP[id])
    .filter(Boolean) as ExperienceType[];
  return out.length > 0 ? out : DEFAULT_TYPES.map((id) => EXPERIENCE_TYPE_MAP[id]);
}
