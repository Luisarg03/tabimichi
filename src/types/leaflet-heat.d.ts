/**
 * Types for leaflet.heat (0.2.0) — the package ships none.
 * The plugin attaches `L.heatLayer` to the global Leaflet namespace, so the
 * declaration augments `leaflet` rather than declaring a module with exports.
 */
import "leaflet";

declare module "leaflet" {
  interface HeatLayerOptions {
    /** minimum opacity of the layer (0–1) */
    minOpacity?: number;
    maxZoom?: number;
    /** value the gradient saturates at — our weights are already 0..1 */
    max?: number;
    radius?: number;
    blur?: number;
    gradient?: Record<number, string>;
  }

  interface HeatLayer extends Layer {
    setLatLngs(latlngs: Array<[number, number, number?]>): this;
    addLatLng(latlng: [number, number, number?]): this;
    setOptions(options: HeatLayerOptions): this;
    redraw(): this;
  }

  function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: HeatLayerOptions
  ): HeatLayer;
}
