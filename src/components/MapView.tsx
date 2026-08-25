"use client";

import { memo, useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLng, ScoredPlace } from "@/lib/types";
import { DEFAULT_TILE, TILE_STYLES, tileStyleById } from "@/lib/tiles";
import { useI18n } from "@/lib/i18n";

const TILE_ICONS: Record<string, string> = {
  esri: "🏙️",
  osm: "🗺️",
  voyager: "🎨",
  positron: "⬜",
  satellite: "🛰️",
};

/** Tile-layer switcher (bottom-left): persists the choice per browser.
 *  On mobile it renders compact (icons only) and moves to bottom-center so
 *  it never hides behind the results column. */
/**
 * Bottom-right zoom control.
 * react-leaflet v5's <ZoomControl position=…> applies the position during
 * render, before the map has initialized its control corners — it crashes
 * with "map._controlCorners is undefined" on remounts (Fast Refresh, reused
 * container). Adding the control from an effect after mount (and removing it
 * on unmount) is safe: the map is fully initialized by then. The `_controlCorners`
 * guard only matters during dev HMR, where a reused container can briefly hold
 * a half-initialized map — skip and let the auto full-reload recover.
 */
function ZoomControlBR() {
  const map = useMap();
  useEffect(() => {
    if (!(map as unknown as { _controlCorners?: object })._controlCorners) return;
    const ctrl = L.control.zoom({ position: "bottomright" });
    ctrl.addTo(map);
    return () => {
      ctrl.remove();
    };
  }, [map]);
  return null;
}

function TileSwitcher({
  tileId,
  onChange,
}: {
  tileId: string;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="absolute bottom-24 right-2 z-[1000] flex max-w-[calc(100%-1rem)] flex-wrap gap-0.5 rounded-panel border border-border bg-surface/95 p-1 shadow-soft backdrop-blur md:right-2">
      {TILE_STYLES.map((s) => (
        <button
          key={s.id}
          onClick={() => onChange(s.id)}
          title={t(`map.tiles.${s.id}`)}
          aria-label={t(`map.tiles.${s.id}`)}
          className={`flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition-colors min-h-[36px] sm:px-2 ${
            tileId === s.id
              ? "bg-brand-600 text-surface"
              : "text-muted hover:bg-fg/5 hover:text-fg active:bg-fg/10"
          }`}
        >
          <span>{TILE_ICONS[s.id] ?? "🗺️"}</span>
          <span className="hidden sm:inline">{t(`map.tiles.${s.id}`)}</span>
        </button>
      ))}
    </div>
  );
}

/** "My location" floating button: re-centers the map on the input position
 *  (Google-Maps-style crosshair FAB, stacked above the tile switcher). */
function LocateButton({ center }: { center: LatLng }) {
  const map = useMap();
  const { t } = useI18n();
  return (
    <button
      onClick={() => map.flyTo([center.lat, center.lng], Math.max(map.getZoom(), 13), { duration: 0.6 })}
      aria-label={t("map.locate")}
      title={t("map.locate")}
      className="absolute bottom-44 right-2 z-[1000] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-fg shadow-soft backdrop-blur transition-colors hover:bg-fg/5 active:bg-fg/10"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
    </button>
  );
}

/** Ranked place marker (prototype .marker): cinnabar numbered circle. */
function markerIcon(rank: number): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:30px;height:30px;border-radius:9999px;background:var(--color-verm, #c04b33);color:#fff;border:2px solid #fff;box-shadow:0 4px 12px rgba(192,75,51,.35);display:flex;align-items:center;justify-content:center;font-family:ui-monospace,monospace;font-size:12px;font-weight:700;transition:transform .15s">${rank}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
  });
}

/** Selected marker: bigger, deeper cinnabar, accent pulse ring. */
function selectedIcon(rank: number): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:38px;height:38px;border-radius:9999px;background:var(--color-verm-deep, #9c3a24);color:#fff;border:2px solid #fff;box-shadow:0 4px 12px rgba(156,58,36,.4);display:flex;align-items:center;justify-content:center;font-family:ui-monospace,monospace;font-size:14px;font-weight:700;z-index:1000">${rank}</div>
           <div class="tabi-pulse-ring" style="position:absolute;top:50%;left:50%;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:9999px;border:3px solid var(--color-brand-500, #454e95);pointer-events:none"></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -22],
  });
}

/** "You are here" marker: filled accent dot with halo + label. */
function userIcon(label: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:18px;height:18px;border-radius:9999px;background:var(--color-brand-600, #3d47a8);border:3px solid #fff;box-shadow:0 0 0 4px rgba(61,71,168,.25),0 2px 8px rgba(0,0,0,.2)"></div>
           <div style="position:absolute;left:26px;top:50%;transform:translateY(-50%);white-space:nowrap;font-size:11px;font-weight:700;color:var(--color-fg,#1f2433);background:rgba(255,255,255,.92);backdrop-filter:blur(6px);padding:3px 8px;border-radius:9999px;border:1px solid var(--color-border,#e7e4dc)">${label}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function FlyTo({ center, zoom }: { center: LatLng; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([center.lat, center.lng], zoom, { duration: 0.6 });
  }, [center.lat, center.lng, zoom, map]);
  return null;
}

/** Fly to the selected place so the user can follow the selection. */
function FlyToSelected({ place }: { place?: ScoredPlace | null }) {
  const map = useMap();
  useEffect(() => {
    if (place) {
      map.flyTo([place.lat, place.lng], 15, { duration: 0.7 });
    }
  }, [place?.id, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Memoized place markers: photo-batch re-renders of the parent (new `places`
 *  array) still recreate these, but unrelated re-renders (selection, tile
 *  switch) with a stable `places` reference skip Leaflet marker recreation. */
const PlaceMarkers = memo(function PlaceMarkers({
  places,
  onSelect,
}: {
  places: ScoredPlace[];
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {places.map((p, i) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={markerIcon(i + 1)}
          eventHandlers={{ click: () => onSelect(p.id) }}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-semibold">{p.name}</div>
              <div className="text-muted">
                {t("card.travel", { min: p.travelMin })} ·{" "}
                {p.rating !== undefined && t("card.rating", { r: p.rating.toFixed(1) })}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
});

export default function MapView({
  center,
  places,
  selectedId,
  userApproximate = false,
  onSelect,
}: {
  center: LatLng;
  places: ScoredPlace[];
  selectedId?: string | null;
  /** true when the position comes from a searched address (geocoded, not GPS) */
  userApproximate?: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const selected = places.find((p) => p.id === selectedId) ?? null;
  const [tileId, setTileId] = useState<string>(() => {
    try {
      return localStorage.getItem("tabi.tiles") ?? DEFAULT_TILE;
    } catch {
      return DEFAULT_TILE;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("tabi.tiles", tileId);
    } catch {
      // ignore
    }
  }, [tileId]);
  const tile = tileStyleById(tileId);

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={13}
        className="h-full w-full"
        scrollWheelZoom
        // default zoom control sits top-left — hidden under the floating
        // header/column; bottom-right is the only free corner
        zoomControl={false}
      >
        <ZoomControlBR />
        <TileLayer
          key={tile.id}
          attribution={tile.attribution}
          url={tile.url}
          // never pass undefined: react-leaflet would override Leaflet's
          // default subdomains with undefined and _getSubdomain crashes
          subdomains={tile.subdomains ?? "abc"}
        />
        <FlyTo center={center} zoom={13} />
        <FlyToSelected place={selected} />

      {/* you are here — visual reference of the input position */}
      <Marker position={[center.lat, center.lng]} icon={userIcon(t("map.youAreHere"))} zIndexOffset={500}>
        <Popup>
          <div className="text-sm">
            <div className="font-semibold">{t("map.youAreHere")}</div>
            <div className="text-muted">
              {userApproximate ? t("map.approx") : t("map.exact")}
            </div>
          </div>
        </Popup>
      </Marker>

      <PlaceMarkers places={places} onSelect={onSelect} />
      {/* selected place: bigger highlighted marker rendered last → on top */}
      {selected && (
        <Marker
          key={`sel-${selected.id}`}
          position={[selected.lat, selected.lng]}
          icon={selectedIcon(places.findIndex((p) => p.id === selected.id) + 1)}
          zIndexOffset={1000}
          eventHandlers={{ click: () => onSelect(selected.id) }}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-semibold">{selected.name}</div>
              <div className="text-muted">
                {t("card.travel", { min: selected.travelMin })} ·{" "}
                {selected.rating !== undefined && t("card.rating", { r: selected.rating.toFixed(1) })}
              </div>
            </div>
          </Popup>
        </Marker>
      )}

      {/* "my location" FAB — must live inside MapContainer to use useMap() */}
      <LocateButton center={center} />
      </MapContainer>
      {/* switcher sits above the map but below the page overlay */}
      <TileSwitcher tileId={tileId} onChange={setTileId} />
    </div>
  );
}
