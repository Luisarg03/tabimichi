"use client";

import { useState } from "react";
import type { Reason, ScoredPlace } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { fmtCount } from "@/lib/format";
import { dirsUrl as dirsUrlFor, placeUrl as placeUrlFor } from "@/lib/maps-urls";
import PlaceGallery from "@/components/PlaceGallery";
import DetailHeroIllustration from "@/components/DetailHeroIllustration";
import WikiPhoto from "@/components/WikiPhoto";
import Icon from "@/components/ui/Icon";
import ScoreRing from "@/components/ui/ScoreRing";
import { CROWD_COLOR, CROWD_SOFT, crowdFactors, crowdSourceLabel } from "@/components/ui/CrowdBadge";

const MODE_ICON: Record<string, string> = { walking: "walk", transit: "train", car: "car" };

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

/**
 * "Gente ahora" for one place: the level, why it is that level, the quietest
 * hour left today, and the one-tap observation that turns the estimate into
 * ground truth. Self-contained: it owns the POST, so no parent has to plumb
 * a reporting callback through the panel/sheet stack.
 */
function CrowdSection({ place }: { place: ScoredPlace }) {
  const { t, locale } = useI18n();
  const { getToken } = useAuth();
  const [reported, setReported] = useState<0 | 1 | 2 | null>(null);
  const [failed, setFailed] = useState(false);
  const crowd = place.crowd;
  if (!crowd) return null;

  const factors = crowdFactors(crowd, t);
  const bestHour =
    crowd.bestHour !== undefined
      ? t(place.openNow === false ? "crowd.bestHourApprox" : "crowd.bestHour", {
          hour: String(crowd.bestHour).padStart(2, "0"),
        })
      : undefined;

  const send = async (level: 0 | 1 | 2) => {
    setReported(level);
    setFailed(false);
    try {
      const token = await getToken();
      const res = await fetch("/api/crowd/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ placeId: place.id, level, lat: place.lat, lng: place.lng }),
      });
      if (!res.ok) throw new Error("bad response");
    } catch {
      setFailed(true);
    }
  };

  return (
    <div
      className="mt-3.5 rounded-panel border p-3"
      style={{ borderColor: CROWD_SOFT[crowd.label], background: CROWD_SOFT[crowd.label] }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.05em]" style={{ color: CROWD_COLOR[crowd.label] }}>
          <span className="h-2 w-2 rounded-full" style={{ background: CROWD_COLOR[crowd.label] }} />
          {t("crowd.title")}
        </span>
        <span className="text-[11px] font-semibold text-muted">
          {crowdSourceLabel(crowd, t, locale)}
        </span>
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <b className="font-display text-[17px] font-bold" style={{ color: CROWD_COLOR[crowd.label] }}>
          {t(`crowd.label.${crowd.label}`)}
        </b>
        {factors.length > 0 && <span className="text-[12px] text-muted">· {factors.join(" · ")}</span>}
      </div>

      {bestHour && <p className="mt-1 text-[12.5px] font-semibold text-fg">{bestHour}</p>}
      <p className="mt-1 text-[11.5px] text-muted">{t("crowd.basedOn")}</p>

      <p className="mt-2.5 text-[12px] font-semibold text-fg">{t("crowd.reportQuestion")}</p>
      <div className="mt-1.5 flex gap-1.5">
        {([0, 1, 2] as const).map((level) => {
          const key = level === 0 ? "empty" : level === 1 ? "normal" : "packed";
          const active = reported === level;
          return (
            <button
              key={level}
              onClick={(e) => {
                e.stopPropagation();
                void send(level);
              }}
              aria-pressed={active}
              className={`min-h-[38px] flex-1 rounded-[11px] border px-2 text-[12.5px] font-semibold transition-colors ${
                active
                  ? "border-brand-500/50 bg-surface text-brand-600"
                  : "border-border bg-surface/70 text-fg hover:bg-surface"
              }`}
            >
              {t(`crowd.report.${key}`)}
            </button>
          );
        })}
      </div>
      {reported !== null && !failed && (
        <p className="mt-1.5 text-[11.5px] font-semibold text-ok">✓ {t("crowd.reportThanks")}</p>
      )}
      {failed && <p className="mt-1.5 text-[11.5px] font-semibold text-bad">{t("crowd.reportError")}</p>}
    </div>
  );
}

/** Full place detail (photo/illustration hero, meta, actions, reasons, guide,
 *  votes). Rendered inside the desktop PlaceDetailPanel and the mobile
 *  detail sheet. */export default function PlaceDetail({
  place,
  origin,
  mode,
  narratedBy,
  model,
  voted,
  onFeedback,
}: {
  place: ScoredPlace;
  origin: { lat: number; lng: number };
  mode: string;
  narratedBy?: string;
  /** model id that narrated (shown in the guide badge when known) */
  model?: string;
  voted?: "like" | "dislike" | null;
  onFeedback?: (placeId: string, liked: boolean, tags?: string[]) => void;
}) {
  const { t, locale } = useI18n();
  const googlePlaceId = place.id.startsWith("g_") ? place.id.slice(2) : null;
  const mapsPlace = { name: place.name, googlePlaceId, lat: place.lat, lng: place.lng };
  const dirsUrl = dirsUrlFor({ lat: origin.lat, lng: origin.lng }, mapsPlace, mode);
  const mapsUrl = placeUrlFor(mapsPlace);
  const photoRefs = place.photoRefs && place.photoRefs.length > 0 ? place.photoRefs : place.photoRef ? [place.photoRef] : [];
  const km = place.distanceKm.toLocaleString(locale, { maximumFractionDigits: 1 });

  return (
    <div className="flex h-full flex-col">
      {/* photo hero: gallery → free Wikipedia photo → per-type illustration */}
      <div className="relative shrink-0">
        {photoRefs.length > 0 ? (
          <PlaceGallery photoRefs={photoRefs} placeId={place.id} alt={place.name} imgClassName="h-52 w-full object-cover sm:h-60" />
        ) : (
          <DetailHeroIllustration className="h-52 w-full sm:h-60" tag={place.tags[0]}>
            {place.wikipedia && (
              <WikiPhoto
                wikiRef={place.wikipedia}
                alt={place.name}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
          </DetailHeroIllustration>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[env(safe-area-inset-bottom)]">
        {/* name + score ring */}
        <div className="detail-head flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[21px] font-bold leading-snug tracking-[-0.015em] text-fg">
              {place.name}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {place.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-fg/5 px-2 py-0.5 text-[11px] font-semibold text-muted"
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
          </div>
          <ScoreRing score={place.score} size="lg" />
        </div>

        {/* meta row */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-panel bg-fg/5 px-3 py-2.5 text-[12.5px] text-muted">
          <span className="flex items-center gap-1.5">
            <Icon name={MODE_ICON[mode] ?? "walk"} size={15} className="text-muted" />
            <b className="mono font-semibold text-fg">{place.travelMin} min</b>
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="locate" size={15} className="text-muted" />
            <b className="font-semibold text-fg">{km} km</b>
          </span>
          {place.rating !== undefined && (
            <span className="flex items-center gap-1.5">
              <span className="font-bold text-fg">★</span>
              <b className="font-semibold text-fg">
                {place.rating.toLocaleString(locale, { maximumFractionDigits: 1 })}
              </b>
              {place.userRatingsTotal !== undefined && (
                <span>({fmtCount(place.userRatingsTotal)} {t("card.reviewsLabel")})</span>
              )}
            </span>
          )}
          {place.priceLevel !== undefined && <span>💰 {t("card.price", { n: place.priceLevel })}</span>}
        </div>

        {place.address && <p className="mt-2 text-[12.5px] text-muted">{place.address}</p>}

        <CrowdSection place={place} />

        {/* actions */}
        <div className="mt-3.5 flex items-center gap-2">
          <a
            href={dirsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 text-[14px] font-semibold text-surface shadow-accent transition-colors hover:bg-brand-700 active:bg-brand-800"
          >
            <Icon name="walk" size={16} />
            {t("card.openInMaps")}
          </a>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-[12px] border border-border px-4 text-[14px] font-medium text-fg transition-colors hover:bg-fg/5 active:bg-fg/10"
          >
            <Icon name="map" size={16} />
            {t("card.viewInMaps")}
          </a>
          {onFeedback && (
            <div className="flex shrink-0 gap-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFeedback(place.id, true, place.tags);
                }}
                aria-label={t("card.like")}
                className={`grid h-[46px] w-[46px] place-items-center rounded-[12px] border transition-colors ${
                  voted === "like"
                    ? "border-ok/40 bg-ok-soft text-ok"
                    : "border-border text-fg hover:bg-fg/5"
                }`}
              >
                <Icon name="thumb-up" size={17} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFeedback(place.id, false, place.tags);
                }}
                aria-label={t("card.dislike")}
                className={`grid h-[46px] w-[46px] place-items-center rounded-[12px] border transition-colors ${
                  voted === "dislike"
                    ? "border-bad/40 bg-bad-soft text-bad"
                    : "border-border text-fg hover:bg-fg/5"
                }`}
              >
                <Icon name="thumb-up" size={17} className="-scale-y-100" />
              </button>
            </div>
          )}
        </div>
        {voted && <p className="mt-2 text-[12.5px] font-semibold text-ok">✓ {t("card.voted")}</p>}

        {/* guide narrative */}
        {place.why && (
          <div className="mt-3.5 rounded-panel border border-brand-500/25 bg-accent-soft p-3 text-[13px] leading-relaxed text-fg">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-brand-600">
                <Icon name="spark" size={13} />
                {t("card.why")}
              </span>
              {(narratedBy || model) && (
                <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-medium text-brand-600">
                  {model ??
                    (narratedBy === "opencode-go" ? t("card.narrator.paid") : t("card.narrator.free"))}
                </span>
              )}
            </div>
            {place.why}
          </div>
        )}

        {/* reasons */}
        {place.reasons.length > 0 && (
          <div className="mt-3.5">
            <p className="eyebrow">{t("card.reasonsTitle")}</p>
            <ul className="mt-1">
              {place.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 border-t border-border py-1.5 text-[13px] text-fg first:border-t-0">
                  <Icon name="spark" size={15} className="mt-0.5 flex-none text-brand-600" />
                  <span>{renderReason(r, t)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-3 text-[11.5px] text-muted">
          {t("card.source", { src: place.source === "google" ? "Google" : "OpenStreetMap" })}
        </p>
      </div>
    </div>
  );
}
