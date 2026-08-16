/**
 * Map tile layer styles. OSM raster tiles bake labels in the LOCAL language
 * (Japanese in Japan); Esri World Street Map renders English/romanized
 * labels — friendlier for travelers. All layers are free (no key).
 */
export interface TileStyle {
  id: string;
  url: string;
  attribution: string;
  subdomains?: string;
}

export const TILE_STYLES: TileStyle[] = [
  {
    id: "esri",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
  },
  {
    id: "osm",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: "voyager",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: "positron",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: "satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
  },
];

/** Default layer: English labels — the app is a travel guide, not a local map. */
export const DEFAULT_TILE = "esri";

export function tileStyleById(id: string): TileStyle {
  return TILE_STYLES.find((s) => s.id === id) ?? TILE_STYLES[0];
}
