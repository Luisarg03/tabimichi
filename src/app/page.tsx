"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import DayPanel, { type DiscoverPayload } from "@/components/DayPanel";
import ResultsList from "@/components/ResultsList";
import LocaleToggle from "@/components/LocaleToggle";
import SimTabs from "@/components/SimTabs";
import BottomSheet from "@/components/BottomSheet";
import MobileDetailSheet from "@/components/MobileDetailSheet";
import SearchOverlay from "@/components/SearchOverlay";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import type { PlaceProfile, RecommendResult, TimeBudget, TransportMode } from "@/lib/types";
import type { SheetSnap } from "@/lib/sheet";
import { SIM_PRESETS, jstSimulatedDate } from "@/lib/jst";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

interface SavedLocation {
  lat: number;
  lng: number;
  label: string;
  gps?: boolean;
}

const LAST_LOCATION_KEY = "tabi.lastLocation";

/** localStorage-backed "last location" store, read via useSyncExternalStore:
 *  - getServerSnapshot is always null, so the SSR HTML and the client's first
 *    render both show the placeholder (no hydration mismatch);
 *  - after hydration React re-reads getSnapshot and swaps in the saved
 *    location when present.
 *  The parsed object is cached so getSnapshot returns a stable reference
 *  between renders (React compares snapshots with Object.is). */
let lastLocationCache: SavedLocation | null = null;
let lastLocationCacheKey: string | null = null;

function readLastLocation(): SavedLocation | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LAST_LOCATION_KEY);
  } catch {
    raw = null; // private mode / SSR
  }
  if (raw !== lastLocationCacheKey) {
    lastLocationCacheKey = raw;
    try {
      lastLocationCache = raw ? (JSON.parse(raw) as SavedLocation) : null;
    } catch {
      lastLocationCache = null; // corrupted value
    }
  }
  return lastLocationCache;
}

/** Syncs across tabs (storage events fire only in *other* tabs; same-tab
 *  writes dispatch one explicitly in handleDiscover). */
function subscribeLastLocation(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export default function HomePage() {
  const { t, locale } = useI18n();
  const { getToken } = useAuth();
  // Read the persisted location through useSyncExternalStore (server snapshot
  // is always null) instead of a useState initializer, which read localStorage
  // during the client's first render and broke hydration.
  const location = useSyncExternalStore(subscribeLastLocation, readLastLocation, () => null);
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guideState, setGuideState] = useState<"idle" | "thinking" | "done">("idle");
  const [votes, setVotes] = useState<Record<string, "like" | "dislike">>({});
  const [profile, setProfile] = useState<PlaceProfile | null>(null);
  /** "Tus gustos" manager panel visibility */
  const [tastesOpen, setTastesOpen] = useState(false);
  /** time simulation: null = real now; else a SIM_PRESETS id (JST hour) */
  const [simPreset, setSimPreset] = useState<string | null>(null);
  /** Search filters — lifted so they survive the mobile overlay remount and
   *  stay shared between the desktop panel and the mobile overlay. */
  const [budget, setBudget] = useState<TimeBudget>("afternoon");
  const [mode, setMode] = useState<TransportMode>("transit");
  const [types, setTypes] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  /** Mobile results bottom sheet: hidden until a discover runs. */
  const [sheet, setSheet] = useState<SheetSnap>("hidden");
  /** Mobile search overlay (full-screen form). */
  const [searchOpen, setSearchOpen] = useState(false);
  const lastQueryRef = useRef<{
    lat: number;
    lng: number;
    budget: string;
    types: string[];
    mode: string;
    now?: string;
    keyword?: string;
    traceId?: string;
  } | null>(null);
  const lastPlacesRef = useRef<
    Array<{ id: string; name: string; distanceKm: number; travelMin: number; rating?: number; tags: string[] }> | null
  >(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          "/api/feedback",
          token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
        );
        const d = (await res.json()) as { profile: PlaceProfile };
        setProfile(d.profile);
      } catch {
        // profile stays null; voting still works
      }
    })();
  }, [getToken]);

  const origin = location ? { lat: location.lat, lng: location.lng } : null;
  const selected = result?.places.find((p) => p.id === selectedId) ?? null;

  const handleFeedback = useCallback(async (placeId: string, liked: boolean, tags?: string[]) => {
    setVotes((v) => ({ ...v, [placeId]: liked ? "like" : "dislike" }));
    try {
      const token = await getToken();
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ placeId, liked, tags }),
      });
      if (res.ok) {
        const d = (await res.json()) as { profile: PlaceProfile };
        setProfile(d.profile);
      }
    } catch {
      // optimistic vote stays; profile updates on next action
    }
  }, [getToken]);

  const handleDiscover = useCallback(
    async (payload: DiscoverPayload) => {
      // Mobile: close the search overlay and open the results sheet.
      setSearchOpen(false);
      setSheet("peek");
      setLoading(true);
      setError(false);
      setResult(null);
      setSelectedId(null);
      setGuideState("idle");
      try {
        const loc = { lat: payload.lat, lng: payload.lng, label: payload.label, gps: payload.gps === true };
        setMode(payload.mode);
        try {
          localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(loc));
          // storage events only fire in other tabs — notify this tab's store
          window.dispatchEvent(new Event("storage"));
        } catch {
          // ignore (private mode / quota); in-memory location still updates
        }

        // time simulation: convert the preset to an ISO instant (JST hour)
        let now: string | undefined;
        if (simPreset) {
          const preset = SIM_PRESETS.find((p) => p.id === simPreset);
          if (preset) now = jstSimulatedDate(preset.hour).toISOString();
        }

        // phase 1 (fast): rules pipeline — weather, discovery, scoring.
        // Send the session JWT so the server loads THIS user's API keys
        // (Google/Geoapify/…) instead of falling back to operator env vars.
        const token = await getToken();
        const res = await fetch("/api/recommend", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            lat: payload.lat,
            lng: payload.lng,
            budget: payload.budget,
            types: payload.types,
            mode: payload.mode,
            lang: locale,
            now,
            keyword: payload.keyword,
          }),
        });
        if (!res.ok) throw new Error("bad response");
        const data = (await res.json()) as RecommendResult;
        setResult(data);
        setLoading(false);

        // photo enrichment (async, non-blocking): search APIs give ~1 photo,
        // Place Details up to 8 — cards update when the refs arrive.
        // Top-12 matches MAX_ENRICH on /api/photos (the visible slice gets photos).
        if (data.places.length > 0) {
          const topIds = data.places
            .slice(0, 12)
            .map((p) => p.id)
            .join(",");
          fetch(
            `/api/photos?ids=${encodeURIComponent(topIds)}${data.traceId ? `&trace=${data.traceId}` : ""}`,
            token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
          )
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              const map = d?.photos as Record<string, string[]> | undefined;
              if (!map) return;
              setResult((prev) => {
                if (!prev) return prev;
                let changed = false;
                const places = prev.places.map((p) => {
                  const refs = map[p.id];
                  if (refs && refs.length > (p.photoRefs?.length ?? 0)) {
                    changed = true;
                    return { ...p, photoRefs: refs, photoRef: refs[0] };
                  }
                  return p;
                });
                return changed ? { ...prev, places } : prev;
              });
            })
            .catch(() => {});
        }

        if (data.places.length > 0) {
          lastQueryRef.current = {
            lat: payload.lat,
            lng: payload.lng,
            budget: payload.budget,
            types: payload.types,
            mode: payload.mode,
            now,
            keyword: payload.keyword,
            traceId: data.traceId,
          };
          // /api/narrate caps the payload at 12 places — send the visible top
          lastPlacesRef.current = data.places.slice(0, 12).map((p) => ({
            id: p.id,
            name: p.name,
            distanceKm: p.distanceKm,
            travelMin: p.travelMin,
            rating: p.rating,
            tags: p.tags,
          }));
        }
      } catch {
        setError(true);
        setLoading(false);
      }
    },
    [locale, simPreset, getToken]
  );

  /** "Tus gustos": set one tag weight directly (optimistic, then server truth). */
  const handleTaste = useCallback(async (tag: string, delta: number) => {
    const cur = profile?.[tag] ?? 0;
    const next = Math.max(-5, Math.min(5, cur + delta));
    setProfile((p) => ({ ...(p ?? {}), [tag]: next }));
    try {
      const token = await getToken();
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ tag, weight: next }),
      });
      if (res.ok) {
        const d = (await res.json()) as { profile: PlaceProfile };
        setProfile(d.profile);
      }
    } catch {
      // optimistic value stays; next action reconciles
    }
  }, [profile, getToken]);

  /** "Tus gustos": reset the whole learned profile. */
  const handleTasteReset = useCallback(async () => {
    setProfile({});
    try {
      const token = await getToken();
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reset: true }),
      });
      if (res.ok) {
        const d = (await res.json()) as { profile: PlaceProfile };
        setProfile(d.profile);
      }
    } catch {
      // ignore
    }
  }, [getToken]);

  /** On-demand guide: narrates the current results (button, not automatic). */
  const narrateNow = useCallback(async () => {
    const q = lastQueryRef.current;
    if (!q || (lastPlacesRef.current?.length ?? 0) === 0) return;
    setGuideState("thinking");
    try {
      const narrRes = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...q, lang: locale, places: lastPlacesRef.current }),
      });
      if (narrRes.ok) {
        const narr = (await narrRes.json()) as {
          summary?: string;
          narratives?: Record<string, string>;
          narratedBy?: string;
        };
        setResult((prev) => {
          if (!prev) return prev;
          const narrMap = narr.narratives ?? {};
          return {
            ...prev,
            narrated: true,
            narratedBy: narr.narratedBy,
            summary: narr.summary,
            places: prev.places.map((p) =>
              narrMap[p.id] ? { ...p, why: narrMap[p.id] } : p
            ),
          };
        });
      }
    } catch {
      // guide unavailable — cards with rule reasons remain
    } finally {
      setGuideState("done");
    }
  }, [locale]);

  const closeDetail = useCallback(() => setSelectedId(null), []);

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      {/* full-screen map background */}
      <div className="absolute inset-0 z-0">
        {location ? (
          <MapView
            center={{ lat: location.lat, lng: location.lng }}
            places={result?.places ?? []}
            selectedId={selectedId}
            userApproximate={location.gps !== true}
            onSelect={setSelectedId}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-400">
            {t("map.nearby")}
          </div>
        )}
      </div>

      {/* ============ DESKTOP (md+) ============ */}
      <div className="pointer-events-none absolute inset-0 z-10 hidden md:block">
        <div className="pointer-events-none flex h-full flex-col gap-2 p-3">
          {/* header row: brand + locale/settings */}
          <div className="pointer-events-auto flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-sm">
              <span className="text-base">🗾</span>
              <span className="text-sm font-bold text-slate-900">
                {t("app.name")} <span className="font-normal text-slate-400">旅</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <LocaleToggle />
              <Link
                href="/settings"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-slate-300 bg-white/95 p-1.5 text-sm text-slate-700 shadow-sm backdrop-blur hover:bg-slate-50 active:bg-slate-100"
                title={t("nav.settings")}
              >
                ⚙️
              </Link>
            </div>
          </div>

          {/* left column: sim + search + results */}
          <div className="pointer-events-auto flex w-[26rem] min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <div className="shrink-0 rounded-xl border border-slate-200 bg-white/95 px-1.5 py-1 shadow-sm">
              <SimTabs preset={simPreset} onChange={setSimPreset} />
            </div>
            <DayPanel
              initialLocation={location}
              loading={loading}
              onDiscover={handleDiscover}
              budget={budget}
              mode={mode}
              types={types}
              keyword={keyword}
              onBudgetChange={setBudget}
              onModeChange={setMode}
              onTypesChange={setTypes}
              onKeywordChange={setKeyword}
            />
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
              <ResultsList
                loading={loading}
                error={error}
                result={result}
                profile={profile}
                mode={mode}
                selectedId={selectedId}
                onSelect={setSelectedId}
                tastesOpen={tastesOpen}
                onTastesToggle={() => setTastesOpen((v) => !v)}
                onTaste={handleTaste}
                onTasteReset={handleTasteReset}
                onNarrate={narrateNow}
                guideState={guideState}
              />
            </div>
          </div>
        </div>

        {/* right place-detail panel */}
        {selected && origin && (
          <PlaceDetailPanel
            place={selected}
            origin={origin}
            mode={mode}
            narratedBy={result?.narratedBy}
            voted={votes[selected.id] ?? null}
            onFeedback={handleFeedback}
            onClose={closeDetail}
          />
        )}
      </div>

      {/* ============ MOBILE (<md) ============ */}
      <div className="pointer-events-none absolute inset-0 z-10 md:hidden">
        <div className="pointer-events-none flex h-full flex-col gap-1.5 p-2 tabi-safe-top tabi-safe-x">
          {/* top: search pill + locale/settings */}
          <div className="pointer-events-auto flex items-center justify-between gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2.5 text-left shadow-sm min-h-[44px]"
              aria-label={t("panel.where")}
            >
              <span className="text-base">📍</span>
              <span className="truncate text-sm font-medium text-slate-700">
                {location ? location.label : t("panel.where")}
              </span>
              {loading && <span className="animate-pulse text-xs">⏳</span>}
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
              <LocaleToggle />
              <Link
                href="/settings"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-slate-300 bg-white/95 text-sm text-slate-700 shadow-sm hover:bg-slate-50 active:bg-slate-100"
                title={t("nav.settings")}
              >
                ⚙️
              </Link>
            </div>
          </div>

          {/* time simulation chips */}
          <div className="pointer-events-auto shrink-0 rounded-xl border border-slate-200 bg-white/95 px-1.5 py-1 shadow-sm">
            <SimTabs preset={simPreset} onChange={setSimPreset} />
          </div>
        </div>
      </div>

      {/* mobile results sheet (hidden on desktop) */}
      {sheet !== "hidden" && !searchOpen && (
        <div className="md:hidden">
          <BottomSheet
            snap={sheet}
            onSnapChange={setSheet}
            title={t("sheet.results")}
            summary={
              result && !loading
                ? `${t("sheet.placesCount", { n: result.places.length })} · ${result.weather.tempC}°C`
                : undefined
            }
          >
            <ResultsList
              loading={loading}
              error={error}
              result={result}
              profile={profile}
              mode={mode}
              selectedId={selectedId}
              onSelect={setSelectedId}
              tastesOpen={tastesOpen}
              onTastesToggle={() => setTastesOpen((v) => !v)}
              onTaste={handleTaste}
              onTasteReset={handleTasteReset}
              onNarrate={narrateNow}
              guideState={guideState}
            />
          </BottomSheet>
        </div>
      )}

      {/* mobile place-detail sheet (hidden on desktop) */}
      {selected && origin && !searchOpen && (
        <div className="md:hidden">
          <MobileDetailSheet
            place={selected}
            origin={origin}
            mode={mode}
            narratedBy={result?.narratedBy}
            voted={votes[selected.id] ?? null}
            onFeedback={handleFeedback}
            onClose={closeDetail}
          />
        </div>
      )}

      {/* mobile search overlay (hidden on desktop) */}
      {searchOpen && (
        <div className="md:hidden">
          <SearchOverlay
            location={location}
            loading={loading}
            onDiscover={handleDiscover}
            onClose={() => setSearchOpen(false)}
            budget={budget}
            mode={mode}
            types={types}
            keyword={keyword}
            onBudgetChange={setBudget}
            onModeChange={setMode}
            onTypesChange={setTypes}
            onKeywordChange={setKeyword}
          />
        </div>
      )}
    </div>
  );
}
