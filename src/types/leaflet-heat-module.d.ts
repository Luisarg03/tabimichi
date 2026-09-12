/**
 * `leaflet.heat` ships no types and its bundle has no exports (it patches the
 * global `L`), so the import exists only for its side effect. The `L.heatLayer`
 * surface it adds is declared in `leaflet-heat.d.ts`.
 */
declare module "leaflet.heat";
