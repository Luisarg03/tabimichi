"use client";

import { useRef, useState } from "react";
import type { ScoredPlace } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import PlaceDetail from "@/components/PlaceDetail";

/**
 * Mobile place-detail sheet: a BOTTOM sheet that leaves the top of the map
 * visible and interactive — tap another marker and the sheet switches to it
 * (no back-and-forth). Swipe-down (or ✕) to close. The container is
 * pointer-events-none so taps above the sheet reach the map; only the sheet
 * itself captures pointer events.
 */
export default function MobileDetailSheet({
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
  const [dy, setDy] = useState(0);
  const startY = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div
        role="dialog"
        aria-label={place.name}
        className={`pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-2xl bg-white shadow-panel-lg ${
          closing ? "transition-transform duration-200" : "tabi-rise-in"
        }`}
        style={{ height: "75dvh", transform: `translateY(${Math.max(0, dy)}px)` }}
      >
        {/* top bar: drag-to-close + back button */}
        <div
          className="shrink-0 cursor-grab touch-none tabi-safe-top active:cursor-grabbing"
          onPointerDown={(e) => {
            if (e.pointerType !== "touch" && e.button !== 0) return;
            startY.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (startY.current === null) return;
            setDy(Math.max(0, e.clientY - startY.current));
          }}
          onPointerUp={(e) => {
            if (startY.current === null) return;
            const moved = e.clientY - startY.current;
            startY.current = null;
            if (moved > 110) {
              setClosing(true);
              onClose();
            } else {
              setDy(0);
            }
          }}
        >
          <div className="flex items-center gap-2 px-3 py-2">
            <button
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={t("detail.back")}
              className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-50 active:bg-slate-100"
            >
              ←
            </button>
            <div className="mx-auto flex flex-col items-center">
              <div className="h-1 w-10 rounded-full bg-slate-300" />
              <span className="mt-1 max-w-[50vw] truncate text-xs font-medium text-slate-400">
                {place.name}
              </span>
            </div>
            <div className="w-[40px]" />
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <PlaceDetail
            place={place}
            origin={origin}
            mode={mode}
            narratedBy={narratedBy}
            voted={voted}
            onFeedback={onFeedback}
          />
        </div>
      </div>
    </div>
  );
}
