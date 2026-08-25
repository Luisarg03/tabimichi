"use client";

import type { ScoredPlace } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import PlaceDetail from "@/components/PlaceDetail";
import Icon from "@/components/ui/Icon";

/** Desktop place-detail panel: slides in from the right when a place is
 *  selected (card or map marker). Hidden below `md` (mobile uses the sheet). */
export default function PlaceDetailPanel({
  place,
  origin,
  mode,
  narratedBy,
  voted,
  onFeedback,
  onClose,
}: {
  place: ScoredPlace;
  origin: { lat: number; lng: number };
  mode: string;
  narratedBy?: string;
  voted?: "like" | "dislike" | null;
  onFeedback?: (placeId: string, liked: boolean, tags?: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <aside
      role="dialog"
      aria-label={place.name}
      className="tabi-slide-in-right pointer-events-auto absolute bottom-3 right-3 top-16 z-20 hidden w-[26rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-panel-lg border border-border bg-surface shadow-panel md:flex"
    >
      <PlaceDetail place={place} origin={origin} mode={mode} narratedBy={narratedBy} voted={voted} onFeedback={onFeedback} />
      {/* close — dark circle over the hero (prototype .detail-close) */}
      <button
        onClick={onClose}
        aria-label={t("detail.close")}
        title={t("detail.close")}
        className="absolute right-2.5 top-2.5 z-10 grid h-9 w-9 place-items-center rounded-full bg-fg/50 text-surface backdrop-blur-sm transition-colors hover:bg-fg/70"
      >
        <Icon name="close" size={16} />
      </button>
    </aside>
  );
}
