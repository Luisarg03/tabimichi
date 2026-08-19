"use client";

import { useEffect, useState } from "react";
import type { TimeBudget, TransportMode } from "@/lib/types";
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
  onClose,
  budget,
  mode,
  types,
  keyword,
  onBudgetChange,
  onModeChange,
  onTypesChange,
  onKeywordChange,
}: {
  initialLocation?: PanelLocation | null;
  loading: boolean;
  onDiscover: (payload: DiscoverPayload) => void;
  /** When set, renders as a full-screen search overlay (mobile):
   *  always-expanded body + close button in the header. */
  onClose?: () => void;
  /** Filter state lifted to the page so it survives panel remounts
   *  (mobile overlay) and stays shared between desktop/mobile. */
  budget: TimeBudget;
  mode: TransportMode;
  types: string[];
  keyword: string;
  onBudgetChange: (b: TimeBudget) => void;
  onModeChange: (m: TransportMode) => void;
  onTypesChange: (t: string[]) => void;
  onKeywordChange: (k: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [locating, setLocating] = useState(false);
  const [location, setLocation] = useState(initialLocation ?? null);
  const [geocodeError, setGeocodeError] = useState(false);
  /** Mobile: panel collapsed by default to not block the map */
  const [collapsed, setCollapsed] = useState(true);

  // Keep the destination in sync with the page's persisted location: during
  // hydration the server snapshot is null, so the state initializer above
  // runs with null even when a saved location exists.
  useEffect(() => {
    if (initialLocation) setLocation(initialLocation); // eslint-disable-line react-hooks/set-state-in-effect
  }, [initialLocation]);

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
    // Collapse after discover so results are visible on mobile.
    // On desktop (md+) the CSS keeps the body open regardless.
    setCollapsed(true);
  }

  const bodyOpen = onClose ? true : !collapsed;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header — always visible; shows the destination + close (overlay) or
          expand/collapse toggle (desktop/mobile column) */}
      <div className="flex items-stretch">
        {onClose ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
              <span className="text-lg">📍</span>
              <span className="truncate text-sm font-medium text-slate-700">
                {location ? location.label : t("panel.where")}
              </span>
            </div>
            <button
              onClick={onClose}
              aria-label={t("detail.close")}
              className="m-1 flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition-colors hover:bg-slate-50 active:bg-slate-100"
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50 md:pointer-events-none md:cursor-default"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-lg">📍</span>
                <span className="truncate text-sm font-medium text-slate-700">
                  {location ? location.label : t("panel.where")}
                </span>
              </div>
              <span className="ml-2 shrink-0 text-xs text-slate-400">{collapsed ? "▸" : "▾"}</span>
            </button>
            {/* quick re-discover while collapsed (mobile only) — sibling of the
                toggle button so no nested interactive elements */}
            {collapsed && location && (
              <button
                onClick={submit}
                disabled={loading}
                className="m-1.5 shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-500 active:bg-brand-700 disabled:opacity-50 md:hidden"
              >
                {loading ? "⏳" : "🔍 " + t("panel.discover")}
              </button>
            )}
          </>
        )}
      </div>

      {/* Collapsible body */}
      <div className={`${bodyOpen ? "block" : "hidden md:block"} px-3 pb-3`}>
        {/* location */}
        <label className="block text-sm font-medium text-slate-700">{t("panel.where")}</label>
        <div className="mt-1.5 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && geocode(query)}
            placeholder={t("panel.searchPlaceholder")}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          <button
            onClick={() => geocode(query)}
            aria-label={t("panel.searchPlaceholder")}
            className="rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 min-h-[44px] min-w-[44px]"
          >
            🔍
          </button>
          <button
            onClick={useGps}
            disabled={locating}
            aria-label={t("panel.useMyLocation")}
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 min-h-[44px] min-w-[44px]"
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
        <div className="mt-3">
          <span className="text-sm font-medium text-slate-700">{t("panel.timeBudget")}</span>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:gap-2">
            {BUDGETS.map((b) => (
              <button
                key={b}
                onClick={() => onBudgetChange(b)}
                className={`rounded-lg border px-1.5 py-2 text-sm font-medium transition-colors min-h-[40px] ${
                  budget === b
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-slate-300 text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                }`}
              >
                {t(`panel.budget.${b}`)}
              </button>
            ))}
          </div>
        </div>

        {/* transport mode */}
        <div className="mt-3">
          <span className="text-sm font-medium text-slate-700">{t("panel.modeLabel")}</span>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => onModeChange(m.id)}
                className={`rounded-lg border px-1.5 py-2 text-sm font-medium transition-colors min-h-[40px] ${
                  mode === m.id
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-300 text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                }`}
              >
                {m.emoji} {t(`panel.mode.${m.id}`)}
              </button>
            ))}
          </div>
        </div>

        {/* type */}
        <div className="mt-3">
          <span className="text-sm font-medium text-slate-700">{t("panel.vibe")}</span>
          {/* Mobile: one horizontally-scrollable row (wrapping 12+ chips would
              eat half the 667px viewport); desktop: wrap as usual. */}
          <div className="mt-1.5 flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5 md:flex-wrap md:overflow-visible">
            <button
              onClick={() => onTypesChange([])}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[36px] ${
                types.length === 0
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50 active:bg-slate-100"
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
                    onTypesChange(
                      active ? types.filter((x) => x !== type.id) : [...types, type.id]
                    )
                  }
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[36px] ${
                    active
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-slate-300 text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                  }`}
                >
                  {type.emoji} {t(`panel.type.${type.id}`)}
                </button>
              );
            })}
          </div>
        </div>

        {/* optional interest keyword */}
        <div className="mt-3">
          <span className="text-sm font-medium text-slate-700">{t("panel.interestLabel")}</span>
          <input
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={t("panel.interestPlaceholder")}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          <p className="mt-1 text-xs text-slate-400">{t("panel.interestHint")}</p>
        </div>

        {/* discover */}
        <button
          onClick={submit}
          disabled={!location || loading}
          className="mt-3 w-full rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? t("panel.discovering") : t("panel.discover")}
        </button>
        {!location && <p className="mt-1.5 text-center text-xs text-slate-400">{t("panel.needLocation")}</p>}
      </div>
    </div>
  );
}
