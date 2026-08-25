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
import BrandPill from "@/components/BrandPill";
import Icon from "@/components/ui/Icon";
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

/** "HH:MM" of the current Japan (UTC+9) wall clock. */
function jstClock(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const h = String(jst.getUTCHours()).padStart(2, "0");
  const m = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
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
  /** Results-header context for "now" — computed client-side only (the real
   *  clock would mismatch SSR); presets are deterministic labels. */
  const [nowCtx, setNowCtx] = useState<string>("");
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

  // live "Ahora · HH:MM JST" for the results header (client-only)
  useEffect(() => {
    const update = () => setNowCtx(`${t("sim.now")} · ${jstClock()} JST`);
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [t]);

  const origin = location ? { lat: location.lat, lng: location.lng } : null;
  const selected = result?.places.find((p) => p.id === selectedId) ?? null;

  /** Results-header context: "Ahora · 15:00 JST" (real clock) or the
   *  deterministic preset label ("Tarde · 15:00 JST"). */
  const simCtx = (() => {
    if (!simPreset) return nowCtx;
    const preset = SIM_PRESETS.find((p) => p.id === simPreset);
    if (!preset) return nowCtx;
    const hh = String(preset.hour).padStart(2, "0");
    return `${t(`sim.${preset.labelKey}`)} · ${hh}:00 JST`;
  })();

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
            pin: payload.pin,
          }),
        });
        if (!res.ok) throw new Error("bad response");
        const data = (await res.json()) as RecommendResult;
        setResult(data);
        setLoading(false);

        // photo enrichment (async, non-blocking): google-sourced places get
        // their refs topped up to 6; OSM/Geoapify places are reconciled
        // against Google by name+coords so they get Google photos too.
        if (data.places.length > 0) {
          const topIds = data.places
            .slice(0, 12)
            .map((p) => p.id)
            .join(",");
          if (topIds) {
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

  const resultsProps = {
    loading,
    error,
    result,
    profile,
    selectedId,
    onSelect: setSelectedId,
    tastesOpen,
    onTastesToggle: () => setTastesOpen((v) => !v),
    onTaste: handleTaste,
    onTasteReset: handleTasteReset,
    onNarrate: narrateNow,
    guideState,
    simCtx,
  } as const;

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
          <div className="flex h-full items-center justify-center bg-bg text-sm text-muted">
            {t("map.nearby")}
          </div>
        )}
      </div>

      {/* ============ DESKTOP (md+) ============ */}
      <div className="pointer-events-none absolute inset-0 z-20 hidden md:block">
        {/* brand + time simulation pills (prototype .brand-pill / .sim-pill) */}
        <BrandPill className="pointer-events-auto absolute left-3 top-3" />
        {/* settings + locale + time simulation (top-right cluster) */}
        <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-1.5">
          <LocaleToggle />
          <Link
            href="/settings"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface/94 text-fg shadow-soft backdrop-blur-md transition-colors hover:bg-fg/5 active:bg-fg/10"
            title={t("nav.settings")}
            aria-label={t("nav.settings")}
          >
            <Icon name="gear" size={18} />
          </Link>
          <SimTabs preset={simPreset} onChange={setSimPreset} />
        </div>

        {/* left rail: search + filters (rail-top) + results (rail-body) */}
        <section className="pointer-events-auto absolute bottom-3 left-3 top-16 flex w-[400px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-panel-lg border border-border bg-surface/95 shadow-panel backdrop-blur-md">
          <div className="flex-none border-b border-border p-3.5">
            <DayPanel
              embedded
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
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3.5">
            <ResultsList {...resultsProps} />
          </div>
        </section>
      </div>

      {/* right place-detail panel (desktop) */}
      {selected && origin && (
        <div className="hidden md:block">
          <PlaceDetailPanel
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

      {/* ============ MOBILE (<md) ============ */}
      <div className="pointer-events-none absolute inset-0 z-10 md:hidden">
        <div className="pointer-events-none flex h-full flex-col gap-1.5 p-2 tabi-safe-top tabi-safe-x">
          {/* top: search pill + locale/settings */}
          <div className="pointer-events-auto flex items-center justify-between gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-surface/95 px-4 py-2.5 text-left shadow-soft min-h-[44px]"
              aria-label={t("panel.where")}
            >
              <Icon name="search" size={17} className="shrink-0 text-muted" />
              <span className="truncate text-sm font-medium text-fg">
                {location ? location.label : t("panel.where")}
              </span>
              {loading && <span className="ml-auto animate-pulse text-xs text-muted">⏳</span>}
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
              <LocaleToggle />
              <Link
                href="/settings"
                className="flex h-[44px] w-[44px] items-center justify-center rounded-full border border-border bg-surface/95 text-fg shadow-soft transition-colors hover:bg-fg/5 active:bg-fg/10"
                title={t("nav.settings")}
              >
                <Icon name="gear" size={18} />
              </Link>
            </div>
          </div>

          {/* time simulation chips */}
          <div className="pointer-events-auto">
            <SimTabs preset={simPreset} onChange={setSimPreset} className="max-w-[calc(100%-1rem)]" />
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
            <ResultsList {...resultsProps} />
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
