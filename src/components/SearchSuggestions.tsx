"use client";

import type { SearchSuggestion } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import Icon, { typeIcon } from "@/components/ui/Icon";

function kindIcon(s: SearchSuggestion): string {
  if (s.kind === "city") return "locate";
  if (s.kind === "address") return "locate";
  return s.typeId ? typeIcon(s.typeId) : "locate";
}

function kindLabel(s: SearchSuggestion, t: (k: string) => string): string | undefined {
  if (s.kind === "city") return t("search.city");
  if (s.kind === "address") return t("search.address");
  return s.typeId ? t(`panel.type.${s.typeId}`) : t("search.place");
}

/** Dropdown of search suggestions — shared by the desktop panel and the
 *  mobile search overlay (both render it under the destination input). */
export default function SearchSuggestions({
  items,
  active,
  open,
  loading,
  query,
  onPick,
  onHover,
}: {
  items: SearchSuggestion[];
  /** index of the keyboard-highlighted row, -1 = none */
  active: number;
  open: boolean;
  loading: boolean;
  query: string;
  onPick: (s: SearchSuggestion) => void;
  onHover: (i: number) => void;
}) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <ul
      id="tabi-suggestions"
      role="listbox"
      aria-label={t("panel.searchPlaceholder")}
      className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-64 overflow-y-auto overscroll-contain rounded-panel border border-border bg-surface shadow-panel"
    >
      {loading && items.length === 0 && (
        <li className="px-3 py-2.5 text-sm text-muted">{t("search.loading")}</li>
      )}
      {!loading && items.length === 0 && (
        <li className="px-3 py-2.5 text-sm text-muted">{t("search.noResults", { q: query })}</li>
      )}
      {items.map((s, i) => (
        <li key={s.id} role="option" aria-selected={i === active} id={`tabi-sugg-${i}`}>
          <button
            type="button"
            onMouseDown={(e) => {
              // pick before the input's blur closes the list
              e.preventDefault();
              onPick(s);
            }}
            onMouseEnter={() => onHover(i)}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
              i === active ? "bg-accent-soft" : "hover:bg-fg/5"
            }`}
          >
            <Icon name={kindIcon(s)} size={15} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{s.name}</span>
              <span className="block truncate text-xs text-muted">
                {[kindLabel(s, t), s.sublabel].filter(Boolean).join(" · ")}
              </span>
            </span>
            {s.rating !== undefined && (
              <span className="shrink-0 text-xs font-semibold text-fg">★{s.rating.toFixed(1)}</span>
            )}
            {s.distanceKm !== undefined && (
              <span className="mono shrink-0 text-xs text-muted">
                {s.distanceKm.toLocaleString(undefined, { maximumFractionDigits: 1 })} km
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
