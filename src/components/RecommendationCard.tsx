"use client";

import type { Reason, ScoredPlace } from "@/lib/types";
import { EXPERIENCE_TYPE_MAP } from "@/lib/places/taxonomy";
import { useI18n } from "@/lib/i18n";

function renderReason(r: Reason, t: ReturnType<typeof useI18n>["t"]): string {
  const params = { ...r.params };
  const typeId = params.typeId as string | undefined;
  if (typeId) {
    params.type = t(`panel.type.${typeId}`);
    delete params.typeId;
  }
  return t(`reasons.${r.key}`, params);
}

export default function RecommendationCard({
  place,
  origin,
  selected,
  onSelect,
}: {
  place: ScoredPlace;
  /** the "where I am" point passed in the input — used as directions origin */
  origin: { lat: number; lng: number };
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const dirsUrl =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}` +
    `&destination=${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;

  return (
    <button
      onClick={() => onSelect(place.id)}
      className={`w-full text-left rounded-xl border p-4 transition-colors ${
        selected
          ? "border-sky-400 bg-sky-50"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900 truncate">{place.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {place.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
              >
                <span>{EXPERIENCE_TYPE_MAP[tag]?.emoji ?? ""}</span>
                {t(`panel.type.${tag}`)}
              </span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-bold text-slate-900">
            {place.score}
            <span className="text-xs font-normal text-slate-400">/100</span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
        <span>📍 {t("card.distance", { km: place.distanceKm })}</span>
        <span>⏱ {t("card.travel", { min: place.travelMin })}</span>
        {place.rating !== undefined && <span>⭐ {t("card.rating", { r: place.rating.toFixed(1) })}</span>}
        {place.priceLevel !== undefined && <span>💰 {t("card.price", { n: place.priceLevel })}</span>}
        {place.openNow === true && <span className="text-emerald-600">● {t("card.open")}</span>}
        {place.openNow === false && <span className="text-rose-600">● {t("card.closed")}</span>}
      </div>

      {place.reasons.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {t("card.reasonsTitle")}
          </div>
          <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
            {place.reasons.map((r, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-emerald-500">✓</span>
                <span>{renderReason(r, t)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {place.source === "google" ? "Google" : "OpenStreetMap"}
        </span>
        <a
          href={dirsUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          {t("card.openInMaps")} ↗
        </a>
      </div>
    </button>
  );
}
