"use client";

import type { ScoredPlace } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { fmtCount } from "@/lib/format";
import Icon, { typeIcon } from "@/components/ui/Icon";
import ScoreRing from "@/components/ui/ScoreRing";

/** Compact list item (prototype .card): icon tile, tags, meta and score
 *  ring. Tapping opens the full detail panel/sheet. */
export default function RecommendationCard({
  place,
  selected,
  onSelect,
}: {
  place: ScoredPlace;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const km = place.distanceKm.toLocaleString(locale, { maximumFractionDigits: 1 });

  return (
    <article
      id={`card-${place.id}`}
      role="button"
      tabIndex={0}
      aria-label={place.name}
      onClick={() => onSelect(place.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(place.id);
        }
      }}
      className={`card relative flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-panel border bg-surface p-2.5 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-fg/25 hover:shadow-soft active:translate-y-px ${
        selected
          ? "border-brand-500/50 shadow-[0_8px_24px_color-mix(in_oklch,var(--color-brand-500)_14%,transparent)]"
          : "border-border"
      }`}
    >
      {/* selection bar (prototype .card::before) */}
      <span
        aria-hidden
        className={`absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-r-[3px] ${
          selected ? "bg-brand-500" : "bg-transparent"
        }`}
      />

      <div className="card-tile grid h-[46px] w-[46px] flex-none place-items-center rounded-[13px] border border-brand-500/25 bg-accent-soft text-brand-600">
        <Icon name={typeIcon(place.tags[0] ?? "viewpoint")} size={20} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[14.5px] font-bold leading-tight tracking-[-0.01em] text-fg">
          {place.name}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {place.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-fg/5 px-2 py-0.5 text-[11px] font-semibold text-muted"
            >
              {t(`panel.type.${tag}`)}
            </span>
          ))}
          {place.openNow === true && (
            <span className="flex items-center gap-1 text-[11.5px] font-semibold text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              {t("card.open")}
            </span>
          )}
          {place.openNow === false && (
            <span className="flex items-center gap-1 text-[11.5px] font-semibold text-bad">
              <span className="h-1.5 w-1.5 rounded-full bg-bad" />
              {t("card.closed")}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted">
          <b className="mono font-semibold text-fg">{place.travelMin} min</b>
          <span>{km} km</span>
          {place.rating !== undefined && (
            <span>
              <span className="font-bold text-fg">★</span>{" "}
              {place.rating.toLocaleString(locale, { maximumFractionDigits: 1 })}
              {place.userRatingsTotal !== undefined && (
                <span className="text-muted"> ({fmtCount(place.userRatingsTotal)})</span>
              )}
            </span>
          )}
        </div>
      </div>

      <ScoreRing score={place.score} size="sm" />
    </article>
  );
}
