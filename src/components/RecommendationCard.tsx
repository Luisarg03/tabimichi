"use client";

import type { ScoredPlace } from "@/lib/types";
import { EXPERIENCE_TYPE_MAP } from "@/lib/places/taxonomy";
import { useI18n } from "@/lib/i18n";
import { fmtCount } from "@/lib/format";
import PlacePhoto from "./PlacePhoto";

const MODE_EMOJI: Record<string, string> = {
  walking: "🚶",
  transit: "🚃",
  car: "🚗",
};

/** Compact list item (Google-Maps-style result row). Tapping opens the
 *  full detail panel/sheet. */
export default function RecommendationCard({
  place,
  mode,
  selected,
  onSelect,
}: {
  place: ScoredPlace;
  /** transport mode used for the recommendation */
  mode: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const photoRef = place.photoRefs?.[0] ?? place.photoRef;
  const emojiBox = (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-2xl">
      {EXPERIENCE_TYPE_MAP[place.tags[0] ?? "viewpoint"]?.emoji ?? "📍"}
    </div>
  );

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
      className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
        selected
          ? "border-brand-400 bg-brand-50"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {photoRef ? (
        <PlacePhoto
          photoRef={photoRef}
          placeId={place.id}
          alt={place.name}
          className="h-20 w-20 shrink-0 rounded-xl object-cover"
          fallback={emojiBox}
        />
      ) : (
        emojiBox
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold text-slate-900">{place.name}</h3>
          <div className="shrink-0 text-right leading-none">
            <span className="text-lg font-bold text-slate-900">{place.score}</span>
            <span className="text-[10px] font-normal text-slate-400">/100</span>
          </div>
        </div>

        {place.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {place.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
              >
                <span>{EXPERIENCE_TYPE_MAP[tag]?.emoji ?? ""}</span>
                {t(`panel.type.${tag}`)}
              </span>
            ))}
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
          <span>📍 {t("card.distance", { km: place.distanceKm })}</span>
          <span>
            {MODE_EMOJI[mode] ?? "🚃"} {t("card.travel", { min: place.travelMin })}
          </span>
          {place.rating !== undefined && (
            <span>
              ⭐ {place.rating.toFixed(1)}
              {place.userRatingsTotal !== undefined && (
                <span className="text-slate-400">
                  {" "}
                  ({fmtCount(place.userRatingsTotal)})
                </span>
              )}
            </span>
          )}
          {place.openNow === true && <span className="text-emerald-600">● {t("card.open")}</span>}
          {place.openNow === false && <span className="text-rose-600">● {t("card.closed")}</span>}
        </div>
      </div>

      <span className="shrink-0 text-slate-300" aria-hidden>
        ›
      </span>
    </article>
  );
}
