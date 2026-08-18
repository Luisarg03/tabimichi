"use client";

import type { ScoredPlace } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import PlaceDetail from "@/components/PlaceDetail";
import IconButton from "@/components/ui/IconButton";

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
      className="tabi-slide-in-right pointer-events-auto absolute bottom-3 right-3 top-3 z-20 hidden w-[26rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel-lg md:flex"
    >
      <PlaceDetail place={place} origin={origin} mode={mode} narratedBy={narratedBy} voted={voted} onFeedback={onFeedback} />
      <IconButton
        label={t("detail.close")}
        onClick={onClose}
        className="absolute right-2 top-2 z-10 bg-white/95 backdrop-blur"
      >
        ✕
      </IconButton>
    </aside>
  );
}
