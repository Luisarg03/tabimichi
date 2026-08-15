"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLng, ScoredPlace } from "@/lib/types";
import { EXPERIENCE_TYPE_MAP } from "@/lib/places/taxonomy";
import { useI18n } from "@/lib/i18n";

function scoreColor(score: number): string {
  if (score >= 70) return "#059669"; // emerald
  if (score >= 50) return "#d97706"; // amber
  return "#e11d48"; // rose
}

function markerIcon(place: ScoredPlace): L.DivIcon {
  const type = place.tags[0] ?? "viewpoint";
  const emoji = EXPERIENCE_TYPE_MAP[type]?.emoji ?? "📍";
  const color = scoreColor(place.score);
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:30px;height:30px;border-radius:9999px;background:#fff;border:2px solid ${color};box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:15px">${emoji}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],
  });
}

/** Highlighted marker for the selected place: pulsing ring, larger, on top. */
function selectedIcon(place: ScoredPlace): L.DivIcon {
  const type = place.tags[0] ?? "viewpoint";
  const emoji = EXPERIENCE_TYPE_MAP[type]?.emoji ?? "📍";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:44px;height:44px;border-radius:9999px;background:#0ea5e9;border:3px solid #fff;box-shadow:0 2px 10px rgba(14,165,233,.55);display:flex;align-items:center;justify-content:center;font-size:20px;z-index:1000">${emoji}</div>
           <div class="tabi-pulse-ring" style="position:absolute;top:50%;left:50%;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:9999px;border:3px solid #0ea5e9;pointer-events:none"></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 44],
    popupAnchor: [0, -44],
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

export default function MapView({
  center,
  places,
  selectedId,
  onSelect,
}: {
  center: LatLng;
  places: ScoredPlace[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const selected = places.find((p) => p.id === selectedId) ?? null;

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={13}
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FlyTo center={center} zoom={13} />
      <FlyToSelected place={selected} />
      {places.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={markerIcon(p)}
          eventHandlers={{ click: () => onSelect(p.id) }}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-semibold">{p.name}</div>
              <div className="text-gray-600">
                {t("card.travel", { min: p.travelMin })} ·{" "}
                {p.rating !== undefined && t("card.rating", { r: p.rating.toFixed(1) })}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
      {/* selected place: bigger highlighted marker rendered last → on top */}
      {selected && (
        <Marker
          key={`sel-${selected.id}`}
          position={[selected.lat, selected.lng]}
          icon={selectedIcon(selected)}
          zIndexOffset={1000}
          eventHandlers={{ click: () => onSelect(selected.id) }}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-semibold">{selected.name}</div>
              <div className="text-gray-600">
                {t("card.travel", { min: selected.travelMin })} ·{" "}
                {selected.rating !== undefined && t("card.rating", { r: selected.rating.toFixed(1) })}
              </div>
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
