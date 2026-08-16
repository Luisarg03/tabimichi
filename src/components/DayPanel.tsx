"use client";

import { useState } from "react";
import type { LatLng, TimeBudget, TransportMode } from "@/lib/types";
import { EXPERIENCE_TYPES } from "@/lib/places/taxonomy";
import { useI18n } from "@/lib/i18n";

export interface DiscoverPayload {
  lat: number;
  lng: number;
  label: string;
  budget: TimeBudget;
  types: string[];
  mode: TransportMode;
  /** true when the position is exact GPS, false when geocoded address */
  gps?: boolean;
  /** optional interest keyword: "pokemon", "book off", "gatos"… */
  keyword?: string;
}

const BUDGETS: TimeBudget[] = ["lunch", "afternoon", "full_day"];
const MODES: Array<{ id: TransportMode; emoji: string }> = [
  { id: "walking", emoji: "🚶" },
  { id: "transit", emoji: "🚃" },
  { id: "car", emoji: "🚗" },
];

interface PanelLocation {
  lat: number;
  lng: number;
  label: string;
  gps?: boolean;
}

export default function DayPanel({
  initialLocation,
  loading,
  onDiscover,
}: {
  initialLocation?: PanelLocation | null;
  loading: boolean;
  onDiscover: (payload: DiscoverPayload) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [locating, setLocating] = useState(false);
  const [location, setLocation] = useState(initialLocation ?? null);
  const [geocodeError, setGeocodeError] = useState(false);
  const [budget, setBudget] = useState<TimeBudget>("afternoon");
  const [mode, setMode] = useState<TransportMode>("transit");
  const [types, setTypes] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");

  async function geocode(q: string) {
    if (!q.trim()) return;
    setGeocodeError(false);
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      setGeocodeError(true);
      return;
    }
    const data = await res.json();
    setLocation({ lat: data.lat, lng: data.lng, label: data.name, gps: false });
  }

  function useGps() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "📍",
          gps: true,
        });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function submit() {
    if (!location) return;
    const kw = keyword.trim();
    onDiscover({ ...location, budget, types, mode, keyword: kw || undefined });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* location */}
      <label className="block text-sm font-medium text-slate-700">{t("panel.where")}</label>
      <div className="mt-1.5 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && geocode(query)}
          placeholder={t("panel.searchPlaceholder")}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        />
        <button
          onClick={() => geocode(query)}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          🔍
        </button>
        <button
          onClick={useGps}
          disabled={locating}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {locating ? "…" : "📍"}
        </button>
      </div>
      {geocodeError && <p className="mt-1 text-xs text-rose-600">{t("status.geocodeError")}</p>}
      {location && (
        <p className="mt-1.5 text-xs text-slate-500">
          {location.label} · {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
        </p>
      )}

      {/* time budget */}
      <div className="mt-4">
        <span className="text-sm font-medium text-slate-700">{t("panel.timeBudget")}</span>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {BUDGETS.map((b) => (
            <button
              key={b}
              onClick={() => setBudget(b)}
              className={`rounded-lg border px-2 py-1.5 text-sm font-medium transition-colors ${
                budget === b
                  ? "border-sky-500 bg-sky-500 text-white"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {t(`panel.budget.${b}`)}
            </button>
          ))}
        </div>
      </div>

      {/* transport mode */}
      <div className="mt-4">
        <span className="text-sm font-medium text-slate-700">{t("panel.modeLabel")}</span>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-lg border px-2 py-1.5 text-sm font-medium transition-colors ${
                mode === m.id
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {m.emoji} {t(`panel.mode.${m.id}`)}
            </button>
          ))}
        </div>
      </div>

      {/* type */}
      <div className="mt-4">
        <span className="text-sm font-medium text-slate-700">{t("panel.vibe")}</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button
            onClick={() => setTypes([])}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              types.length === 0
                ? "border-sky-500 bg-sky-500 text-white"
                : "border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {t("panel.type.any")}
          </button>
          {EXPERIENCE_TYPES.map((type) => {
            const active = types.includes(type.id);
            return (
              <button
                key={type.id}
                onClick={() =>
                  setTypes((prev) =>
                    active ? prev.filter((x) => x !== type.id) : [...prev, type.id]
                  )
                }
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-sky-500 bg-sky-500 text-white"
                    : "border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {type.emoji} {t(`panel.type.${type.id}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* optional interest keyword */}
      <div className="mt-4">
        <span className="text-sm font-medium text-slate-700">{t("panel.interestLabel")}</span>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={t("panel.interestPlaceholder")}
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        />
        <p className="mt-1 text-xs text-slate-400">{t("panel.interestHint")}</p>
      </div>

      {/* discover */}
      <button
        onClick={submit}
        disabled={!location || loading}
        className="mt-4 w-full rounded-xl bg-sky-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? t("panel.discovering") : t("panel.discover")}
      </button>
      {!location && <p className="mt-1.5 text-center text-xs text-slate-400">{t("panel.needLocation")}</p>}
    </div>
  );
}
