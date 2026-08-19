"use client";

import type { Reason, ScoredPlace } from "@/lib/types";
import { EXPERIENCE_TYPE_MAP } from "@/lib/places/taxonomy";
import { useI18n } from "@/lib/i18n";
import { fmtCount } from "@/lib/format";
import { dirsUrl as dirsUrlFor, placeUrl as placeUrlFor } from "@/lib/maps-urls";
import PlaceGallery from "@/components/PlaceGallery";

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

/** Full place detail (photo hero, meta, actions, reasons, guide, votes).
 *  Rendered inside the desktop PlaceDetailPanel and the mobile detail sheet. */
export default function PlaceDetail({
  place,
  origin,
  mode,
  narratedBy,
  voted,
  onFeedback,
}: {
  place: ScoredPlace;
  origin: { lat: number; lng: number };
  mode: string;
  narratedBy?: string;
  voted?: "like" | "dislike" | null;
  onFeedback?: (placeId: string, liked: boolean, tags?: string[]) => void;
}) {
  const { t } = useI18n();
  const googlePlaceId = place.id.startsWith("g_") ? place.id.slice(2) : null;
  const mapsPlace = { name: place.name, googlePlaceId, lat: place.lat, lng: place.lng };
  const dirsUrl = dirsUrlFor({ lat: origin.lat, lng: origin.lng }, mapsPlace, mode);
  const mapsUrl = placeUrlFor(mapsPlace);
  const photoRefs = place.photoRefs && place.photoRefs.length > 0 ? place.photoRefs : place.photoRef ? [place.photoRef] : [];

  return (
    <div className="flex h-full flex-col">
      {/* photo hero */}
      <div className="relative shrink-0">
        <PlaceGallery photoRefs={photoRefs} placeId={place.id} alt={place.name} imgClassName="h-52 w-full object-cover sm:h-60" />
        {photoRefs.length === 0 && (
          <div className="flex h-52 w-full items-center justify-center bg-slate-100 text-4xl">
            {EXPERIENCE_TYPE_MAP[place.tags[0] ?? "viewpoint"]?.emoji ?? "📍"}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[env(safe-area-inset-bottom)]">
        {/* name + score */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-snug text-slate-900">{place.name}</h2>
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
          <div className="shrink-0 rounded-2xl bg-slate-900 px-3 py-1.5 text-center">
            <div className="text-xl font-bold leading-none text-white">{place.score}</div>
            <div className="text-[10px] font-medium text-slate-300">/100</div>
          </div>
        </div>

        {/* meta row */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
          <span>📍 {t("card.distance", { km: place.distanceKm })}</span>
          <span>{t("card.travel", { min: place.travelMin })}</span>
          {place.rating !== undefined && (
            <span>
              ⭐ {place.rating.toFixed(1)}
              {place.userRatingsTotal !== undefined && (
                <span className="text-slate-400"> ({fmtCount(place.userRatingsTotal)} {t("card.reviewsLabel")})</span>
              )}
            </span>
          )}
          {place.priceLevel !== undefined && <span>💰 {t("card.price", { n: place.priceLevel })}</span>}
          {place.openNow === true && <span className="text-emerald-600">● {t("card.open")}</span>}
          {place.openNow === false && <span className="text-rose-600">● {t("card.closed")}</span>}
        </div>

        {place.address && <p className="mt-1 text-xs text-slate-500">📍 {place.address}</p>}

        {/* actions */}
        <div className="mt-3 flex items-center gap-2">
          <a
            href={dirsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-xl bg-brand-600 px-3 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-500 active:bg-brand-700 min-h-[44px]"
          >
            {t("card.openInMaps")} ↗
          </a>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-center text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 min-h-[44px]"
          >
            🗺️ {t("card.viewInMaps")}
          </a>
          {onFeedback && (
            <div className="flex shrink-0 gap-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFeedback(place.id, true, place.tags);
                }}
                aria-label={t("card.like")}
                className={`rounded-xl border px-3 py-2 text-sm transition-colors min-h-[44px] min-w-[44px] ${
                  voted === "like"
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-slate-300 hover:bg-emerald-50 hover:border-emerald-300"
                }`}
              >
                👍
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFeedback(place.id, false, place.tags);
                }}
                aria-label={t("card.dislike")}
                className={`rounded-xl border px-3 py-2 text-sm transition-colors min-h-[44px] min-w-[44px] ${
                  voted === "dislike"
                    ? "border-rose-400 bg-rose-50"
                    : "border-slate-300 hover:bg-rose-50 hover:border-rose-300"
                }`}
              >
                👎
              </button>
            </div>
          )}
        </div>
        {voted && <p className="mt-1.5 text-xs font-medium text-emerald-600">✓ {t("card.voted")}</p>}

        {/* guide narrative */}
        {place.why && (
          <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-slate-800">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-sky-500">{t("card.why")}</span>
              {narratedBy && (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-600">
                  {narratedBy === "opencode-go" ? t("card.narrator.paid") : t("card.narrator.free")}
                </span>
              )}
            </div>
            {place.why}
          </div>
        )}

        {/* reasons */}
        {place.reasons.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{t("card.reasonsTitle")}</div>
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

        <p className="mt-3 text-xs text-slate-400">
          {place.source === "google" ? "Google" : "OpenStreetMap"}
        </p>
      </div>
    </div>
  );
}
