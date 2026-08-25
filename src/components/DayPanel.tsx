"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { SearchSuggestion, TimeBudget, TransportMode } from "@/lib/types";
import { EXPERIENCE_TYPES } from "@/lib/places/taxonomy";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import SearchSuggestions from "@/components/SearchSuggestions";
import Icon from "@/components/ui/Icon";
import IconButton from "@/components/ui/IconButton";
import Segmented from "@/components/ui/Segmented";
import Chip from "@/components/ui/Chip";

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
  /** the exact place the user searched — guaranteed to appear first */
  pin?: { name: string; lat: number; lng: number; typeId?: string };
}

const BUDGETS: TimeBudget[] = ["lunch", "afternoon", "full_day"];
const MODES: Array<{ id: TransportMode; icon: string }> = [
  { id: "walking", icon: "walk" },
  { id: "transit", icon: "train" },
  { id: "car", icon: "car" },
];

/** A single CJK character is a valid search ("寺", "山"); otherwise ≥2. */
const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff]/;
function isValidSearch(q: string): boolean {
  return q.length >= 2 || (q.length === 1 && CJK_RE.test(q));
}

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
  embedded = false,
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
  /** When true (desktop rail), renders only the form — no card wrapper,
   *  header or collapse behavior. */
  embedded?: boolean;
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
  const { getToken } = useAuth();
  const [query, setQuery] = useState("");
  const [locating, setLocating] = useState(false);
  const [location, setLocation] = useState(initialLocation ?? null);
  const [geocodeError, setGeocodeError] = useState(false);
  /** Mobile: panel collapsed by default to not block the map */
  const [collapsed, setCollapsed] = useState(true);

  // --- live search suggestions (place/address autocomplete) ---
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggActive, setSuggActive] = useState(-1);
  const [suggLoading, setSuggLoading] = useState(false);
  const suggAbort = useRef<AbortController | null>(null);
  /** picking a suggestion sets query to the place name — suppress the fetch
   *  that change would otherwise trigger (the dropdown must not reopen). */
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const q = query.trim();
    suggAbort.current?.abort();
    // Invalid/empty input: no setState here — suggOpen is already false via
    // isValidSearch, and the aborted fetch self-heals its loading flag.
    if (!isValidSearch(q)) return;
    const ctrl = new AbortController();
    suggAbort.current = ctrl;
    setSuggLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    const timer = setTimeout(async () => {
      try {
        // Bias suggestions by the current destination when one is set, so
        // results are ranked by distance to the search area. The session JWT
        // lets the server add Google Autocomplete with the user's own key.
        const bias = location
          ? `&lat=${location.lat.toFixed(5)}&lng=${location.lng.toFixed(5)}`
          : "";
        const token = await getToken();
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}${bias}`, {
          signal: ctrl.signal,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        });
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const data = (await res.json()) as { suggestions?: SearchSuggestion[] };
        setSuggestions(data.suggestions ?? []);
        setSuggActive(-1);
      } catch {
        // aborted by newer input (keep current list) or network failure —
        // suggestions degrade to the remote-only list the user already sees
      } finally {
        if (!ctrl.signal.aborted) setSuggLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // location bias is read at fetch time; re-fetching on every destination
    // change would reopen the dropdown while the user is not typing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const suggOpen = (suggestions.length > 0 || suggLoading) && isValidSearch(query.trim());

  /** Run discovery centered on a picked suggestion (Google-Maps behavior:
   *  search → results immediately; filters stay adjustable afterwards). */
  function discoverAt(
    loc: { name: string; lat: number; lng: number; typeId?: string },
    isPlace: boolean
  ) {
    setLocation({ lat: loc.lat, lng: loc.lng, label: loc.name, gps: false });
    setGeocodeError(false);
    onDiscover({
      lat: loc.lat,
      lng: loc.lng,
      label: loc.name,
      budget,
      types,
      mode,
      // the searched place: keyword + pin guarantee it ranks first
      keyword: isPlace ? loc.name : undefined,
      pin: isPlace ? { name: loc.name, lat: loc.lat, lng: loc.lng, typeId: loc.typeId } : undefined,
    });
    setCollapsed(true);
  }

  function pickSuggestion(s: SearchSuggestion) {
    justPicked.current = true;
    setQuery(s.name);
    setSuggestions([]);
    setSuggActive(-1);
    if (s.placeId) {
      // Google prediction: no coords yet — resolve with one Place Details call
      // (BYOK), falling back to geocoding the name with the free sources.
      (async () => {
        try {
          const token = await getToken();
          const res = await fetch(
            `/api/search/resolve?placeId=${encodeURIComponent(s.placeId!)}`,
            token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
          );
          if (res.ok) {
            const hit = (await res.json()) as {
              name: string;
              lat: number;
              lng: number;
              typeId?: string;
            };
            discoverAt(hit, true);
            return;
          }
        } catch {
          // fall through to the free geocoder
        }
        const g = await geocode(s.name);
        if (g) discoverAt({ name: s.name, ...g }, true);
      })();
      return;
    }
    if (s.lat !== undefined && s.lng !== undefined) {
      discoverAt({ name: s.name, lat: s.lat, lng: s.lng, typeId: s.typeId }, s.kind === "place");
    }
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = Math.max(suggestions.length, 1);
      setSuggActive((a) => (a + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.max(suggestions.length, 1);
      setSuggActive((a) => (a <= 0 ? n - 1 : (a - 1 + n) % n));
    } else if (e.key === "Escape") {
      setSuggestions([]);
      setSuggActive(-1);
    } else if (e.key === "Enter") {
      if (suggActive >= 0 && suggestions[suggActive]) {
        e.preventDefault();
        pickSuggestion(suggestions[suggActive]);
      } else {
        geocode(query);
      }
    }
  }

  // Keep the destination in sync with the page's persisted location: during
  // hydration the server snapshot is null, so the state initializer above
  // runs with null even when a saved location exists.
  useEffect(() => {
    if (initialLocation) setLocation(initialLocation); // eslint-disable-line react-hooks/set-state-in-effect
  }, [initialLocation]);

  async function geocode(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
    if (!q.trim()) return null;
    setGeocodeError(false);
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      setGeocodeError(true);
      return null;
    }
    const data = await res.json();
    setLocation({ lat: data.lat, lng: data.lng, label: data.name, gps: false });
    return { lat: data.lat, lng: data.lng, label: data.name };
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
  const activeHint = types.length
    ? types.map((id) => t(`panel.type.${id}`)).join(" · ")
    : t("panel.type.any");

  const form = (
    <div>
      {/* location — live search with place/address autocomplete */}
      <span className="eyebrow">{t("panel.where")}</span>
      <div className="mt-1.5 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSuggActive(-1);
            }}
            onKeyDown={onSearchKeyDown}
            onBlur={() =>
              setTimeout(() => {
                setSuggestions([]);
                setSuggActive(-1);
              }, 150)
            }
            placeholder={t("panel.searchPlaceholder")}
            role="combobox"
            aria-expanded={suggOpen}
            aria-autocomplete="list"
            aria-controls="tabi-suggestions"
            aria-activedescendant={suggActive >= 0 ? `tabi-sugg-${suggActive}` : undefined}
            className="w-full min-h-[44px] rounded-[12px] border border-border bg-surface py-0 pl-10 pr-3 text-[14px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-brand-500 focus:shadow-[0_0_0_3px_var(--color-accent-soft)]"
          />
          <SearchSuggestions
            items={suggestions}
            active={suggActive}
            open={suggOpen}
            loading={suggLoading}
            query={query.trim()}
            onPick={pickSuggestion}
            onHover={setSuggActive}
          />
        </div>
        <IconButton
          onClick={useGps}
          disabled={locating}
          label={t("panel.useMyLocation")}
          className="shrink-0"
        >
          <Icon name="locate" />
        </IconButton>
      </div>
      {geocodeError && <p className="mt-1 text-xs text-bad">{t("status.geocodeError")}</p>}
      {location && (
        <p className="mono mt-1.5 truncate text-xs text-muted">
          {location.label} · {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
        </p>
      )}

      {/* time budget */}
      <div className="mt-3">
        <span className="eyebrow">{t("panel.timeBudget")}</span>
        <Segmented
          className="mt-1.5"
          ariaLabel={t("panel.timeBudget")}
          value={budget}
          onChange={onBudgetChange}
          options={BUDGETS.map((b) => ({ id: b, label: t(`panel.budget.${b}`) }))}
        />
      </div>

      {/* transport mode */}
      <div className="mt-3">
        <span className="eyebrow">{t("panel.modeLabel")}</span>
        <Segmented
          className="mt-1.5"
          ariaLabel={t("panel.modeLabel")}
          value={mode}
          onChange={onModeChange}
          options={MODES.map((m) => ({
            id: m.id,
            label: t(`panel.mode.${m.id}`),
            icon: m.icon,
          }))}
        />
      </div>

      {/* type / vibe */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="eyebrow">{t("panel.vibe")}</span>
          <span className="truncate text-[11.5px] text-muted">{activeHint}</span>
        </div>
        {/* Mobile: one horizontally-scrollable row (wrapping 12+ chips would
            eat half the 667px viewport); desktop: wrap as usual. */}
        <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
          <Chip selected={types.length === 0} onClick={() => onTypesChange([])}>
            {t("panel.type.any")}
          </Chip>
          {EXPERIENCE_TYPES.map((type) => {
            const active = types.includes(type.id);
            return (
              <Chip
                key={type.id}
                selected={active}
                onClick={() =>
                  onTypesChange(active ? types.filter((x) => x !== type.id) : [...types, type.id])
                }
              >
                {t(`panel.type.${type.id}`)}
              </Chip>
            );
          })}
        </div>
      </div>

      {/* optional interest keyword */}
      <div className="mt-3">
        <span className="eyebrow">{t("panel.interestLabel")}</span>
        <input
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={t("panel.interestPlaceholder")}
          className="mt-1.5 w-full min-h-[40px] rounded-[12px] border border-border bg-surface px-3 text-[14px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-brand-500 focus:shadow-[0_0_0_3px_var(--color-accent-soft)]"
        />
        <p className="mt-1 text-xs text-muted">{t("panel.interestHint")}</p>
      </div>

      {/* discover */}
      <button
        onClick={submit}
        disabled={!location || loading}
        className="mt-3 flex w-full min-h-[44px] items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 text-[14px] font-semibold text-surface shadow-accent transition-[background,transform] hover:bg-brand-700 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none"
      >
        <Icon name="spark" size={16} />
        {loading ? t("panel.discovering") : t("panel.discover")}
      </button>
      {!location && <p className="mt-1.5 text-center text-xs text-muted">{t("panel.needLocation")}</p>}
    </div>
  );

  if (embedded) return form;

  return (
    <div className="overflow-hidden rounded-panel border border-border bg-surface shadow-soft">
      {/* Header — always visible; shows the destination + close (overlay) or
          expand/collapse toggle (mobile column) */}
      <div className="flex items-stretch">
        {onClose ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
              <Icon name="locate" size={18} className="text-muted" />
              <span className="truncate text-sm font-medium text-fg">
                {location ? location.label : t("panel.where")}
              </span>
            </div>
            <IconButton label={t("detail.close")} onClick={onClose} className="m-1 shrink-0">
              <Icon name="close" size={16} />
            </IconButton>
          </>
        ) : (
          <>
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-fg/5 md:pointer-events-none md:cursor-default"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Icon name="locate" size={18} className="text-muted" />
                <span className="truncate text-sm font-medium text-fg">
                  {location ? location.label : t("panel.where")}
                </span>
              </div>
              <Icon
                name="chevron-down"
                size={15}
                className={`ml-2 shrink-0 text-muted transition-transform ${collapsed ? "" : "rotate-180"}`}
              />
            </button>
            {/* quick re-discover while collapsed (mobile only) — sibling of the
                toggle button so no nested interactive elements */}
            {collapsed && location && (
              <button
                onClick={submit}
                disabled={loading}
                className="m-1.5 shrink-0 rounded-[12px] bg-brand-600 px-3 py-2 text-xs font-semibold text-surface transition-colors hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 md:hidden"
              >
                {loading ? t("panel.discovering") : t("panel.discover")}
              </button>
            )}
          </>
        )}
      </div>

      {/* Collapsible body */}
      <div className={`${bodyOpen ? "block" : "hidden md:block"} px-3 pb-3`}>{form}</div>
    </div>
  );
}
