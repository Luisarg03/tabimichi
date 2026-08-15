"use client";

import { useEffect, useRef, useState } from "react";
import type { Reason, ScoredPlace } from "@/lib/types";
import { EXPERIENCE_TYPE_MAP } from "@/lib/places/taxonomy";
import { useI18n } from "@/lib/i18n";
import { fmtCount } from "@/lib/format";

function renderReason(r: Reason, t: ReturnType<typeof useI18n>["t"]): string {
  const params = { ...r.params };
  const typeId = params.typeId as string | undefined;
  if (typeId) {
    params.type = t(`panel.type.${typeId}`);
    delete params.typeId;
  }
  const modeId = params.modeId as string | undefined;
  if (modeId) {
    params.mode = t(`panel.mode.${modeId}`);
    delete params.modeId;
  }
  return t(`reasons.${r.key}`, params);
}

const MODE_EMOJI: Record<string, string> = {
  walking: "🚶",
  transit: "🚃",
  car: "🚗",
};

function photoUrl(ref: string, id: string): string {
  return `/api/photo?ref=${encodeURIComponent(ref)}&id=${encodeURIComponent(id)}`;
}

export default function RecommendationCard({
  place,
  origin,
  mode,
  narratedBy,
  selected,
  voted,
  onSelect,
  onFeedback,
}: {
  place: ScoredPlace;
  /** the "where I am" point passed in the input — used as directions origin */
  origin: { lat: number; lng: number };
  /** transport mode used for the recommendation */
  mode: string;
  /** which LLM layer narrated: "opencode-zen" (free) | "opencode-go" (paid) */
  narratedBy?: string;
  selected: boolean;
  /** M3: this place's current vote, if any */
  voted?: "like" | "dislike" | null;
  onSelect: (id: string) => void;
  onFeedback?: (placeId: string, liked: boolean, tags?: string[]) => void;
}) {
  const { t } = useI18n();
  const dirsUrl =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}` +
    `&destination=${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;

  const photoRefs =
    place.photoRefs && place.photoRefs.length > 0
      ? place.photoRefs
      : place.photoRef
        ? [place.photoRef]
        : [];
  const [activeIdx, setActiveIdx] = useState(0);
  const touchX = useRef<number | null>(null);

  // reset the gallery when the card shows a different place
  useEffect(() => {
    setActiveIdx(0);
  }, [place.id]);

  const prevPhoto = () => setActiveIdx((i) => (i - 1 + photoRefs.length) % photoRefs.length);
  const nextPhoto = () => setActiveIdx((i) => (i + 1) % photoRefs.length);

  return (
    <button
      onClick={() => onSelect(place.id)}
      className={`w-full overflow-hidden text-left rounded-xl border p-4 transition-colors ${
        selected
          ? "border-sky-400 bg-sky-50"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {photoRefs.length > 0 && (
        <div
          className="relative -mx-4 -mt-4 mb-3 overflow-hidden bg-slate-100"
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - (touchX.current ?? 0);
            touchX.current = null;
            if (Math.abs(dx) > 40) {
              e.stopPropagation();
              dx > 0 ? prevPhoto() : nextPhoto();
            }
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl(photoRefs[activeIdx]!, place.id)}
            alt={place.name}
            loading="lazy"
            className="h-40 w-full object-cover"
          />
          {photoRefs.length > 1 && (
            <>
              {/* prev / next arrows — bigger hit areas than dots */}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  prevPhoto();
                }}
                className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-xl text-white backdrop-blur-sm transition-colors hover:bg-black/65"
                style={{ cursor: "pointer" }}
                title="←"
              >
                ‹
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  nextPhoto();
                }}
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-xl text-white backdrop-blur-sm transition-colors hover:bg-black/65"
                style={{ cursor: "pointer" }}
                title="→"
              >
                ›
              </span>
              {/* counter */}
              <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                {activeIdx + 1}/{photoRefs.length}
              </span>
            </>
          )}
        </div>
      )}
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
        <span>
          {MODE_EMOJI[mode] ?? "🚃"} {t("card.travel", { min: place.travelMin })}
        </span>
        {place.rating !== undefined && (
          <span>
            ⭐ {t("card.rating", { r: place.rating.toFixed(1) })}
            {place.userRatingsTotal !== undefined && (
              <span className="text-slate-400"> {t("card.reviews", { n: fmtCount(place.userRatingsTotal) })}</span>
            )}
          </span>
        )}
        {place.priceLevel !== undefined && <span>💰 {t("card.price", { n: place.priceLevel })}</span>}
        {place.openNow === true && <span className="text-emerald-600">● {t("card.open")}</span>}
        {place.openNow === false && <span className="text-rose-600">● {t("card.closed")}</span>}
      </div>

      {place.why && (
        <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50 p-3 text-sm text-slate-800">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-sky-500">
              {t("card.why")}
            </span>
            {narratedBy && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-600">
                {narratedBy === "opencode-go" ? t("card.narrator.paid") : t("card.narrator.free")}
              </span>
            )}
          </div>
          {place.why}
        </div>
      )}

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

      {/* M3: 👍/👎 feedback — learns the user's tastes */}
      {onFeedback && (
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-xs text-slate-500">{t("card.voteQuestion")}</span>
          {voted ? (
            <span className="text-xs font-medium text-emerald-600">✓ {t("card.voted")}</span>
          ) : (
            <div className="flex gap-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFeedback(place.id, true, place.tags);
                }}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm hover:bg-emerald-50 hover:border-emerald-300"
                title={t("card.like")}
              >
                👍
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFeedback(place.id, false, place.tags);
                }}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm hover:bg-rose-50 hover:border-rose-300"
                title={t("card.dislike")}
              >
                👎
              </button>
            </div>
          )}
        </div>
      )}
    </button>
  );
}
