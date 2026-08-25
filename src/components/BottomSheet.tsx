"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { dragVelocity, resolveSnap, snapTop, type SheetSnap } from "@/lib/sheet";
import Icon from "@/components/ui/Icon";

const HANDLE_H = 56;

/** Google-Maps-style bottom sheet for mobile: drag handle + snap points
 *  (peek / list / full). Rendered only when snap !== "hidden". */
export default function BottomSheet({
  snap,
  onSnapChange,
  title,
  summary,
  children,
  className = "",
}: {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  title: string;
  /** Optional row inside the handle (e.g. "12 places · 24°"). */
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [vh, setVh] = useState(() =>
    typeof window === "undefined" ? 800 : window.visualViewport?.height ?? window.innerHeight
  );
  // env(safe-area-inset-bottom) is only readable via computed styles — measure
  // once in the state initializer (client-only; 0 on SSR).
  const [safeBottom] = useState(() => {
    if (typeof document === "undefined") return 0;
    const probe = document.createElement("div");
    probe.style.paddingBottom = "env(safe-area-inset-bottom)";
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).paddingBottom);
    probe.remove();
    return Number.isNaN(px) ? 0 : px;
  });
  const [dragTop, setDragTop] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);
  const [handleH, setHandleH] = useState(HANDLE_H);
  const dragStartY = useRef<number | null>(null);
  const startTop = useRef(0);
  const samples = useRef<Array<{ t: number; y: number }>>([]);

  useEffect(() => {
    const onResize = () => setVh(window.visualViewport?.height ?? window.innerHeight);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  useLayoutEffect(() => {
    if (handleRef.current) setHandleH(handleRef.current.offsetHeight);
  }, [summary, title]);

  const currentTop = dragTop ?? snapTop(snap, vh, safeBottom);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== "touch" && e.button !== 0) return;
      dragStartY.current = e.clientY;
      startTop.current = currentTop;
      samples.current = [{ t: performance.now(), y: e.clientY }];
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [currentTop]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragStartY.current === null) return;
      const dy = e.clientY - dragStartY.current;
      const minTop = snapTop("full", vh, safeBottom);
      const maxTop = snapTop("hidden", vh, safeBottom);
      setDragTop(Math.min(maxTop, Math.max(minTop, startTop.current + dy)));
      samples.current.push({ t: performance.now(), y: e.clientY });
      if (samples.current.length > 8) samples.current.shift();
    },
    [vh, safeBottom]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragStartY.current === null) return;
      const dy = e.clientY - dragStartY.current;
      const vel = dragVelocity(samples.current);
      dragStartY.current = null;
      samples.current = [];
      setDragging(false);
      setDragTop(null);
      // tap on the handle (tiny movement): toggle peek ↔ list/full
      if (Math.abs(dy) < 6 && Math.abs(vel) < 0.3) {
        onSnapChange(snap === "peek" ? "list" : "peek");
        return;
      }
      onSnapChange(resolveSnap(snap, dy, vh, safeBottom, vel));
    },
    [snap, vh, safeBottom, onSnapChange]
  );

  const expanded = snap !== "peek" || dragTop !== null;

  return (
    <div
      role="dialog"
      aria-label={title}
      className={`fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-panel-lg border-t border-border bg-surface shadow-panel ${
        dragging ? "" : "transition-transform duration-300 ease-out"
      } ${className}`}
      style={{ height: vh, transform: `translateY(${currentTop}px)`, touchAction: "pan-y" }}
    >
      {/* drag handle + summary (prototype .mobile-summary) */}
      <div
        ref={handleRef}
        className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2 pb-1 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="h-[5px] w-11 rounded-[3px] bg-border" />
        <div className="mt-2 flex w-full items-center justify-between gap-2 px-4 pb-1">
          <span className="truncate font-display text-[16px] font-bold text-fg">{title}</span>
          {summary && (
            <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-muted">
              {summary}
              <Icon
                name="chevron-down"
                size={15}
                className={`text-muted transition-transform duration-300 ${expanded ? "rotate-180" : ""}`}
              />
            </span>
          )}
        </div>
      </div>

      {/* scrollable content — height is computed so the content hugs the
          visible area of the sheet (no flex-grow: the sheet's bottom edge
          sits below the viewport when partially open) */}
      <div
        className="overflow-y-auto overscroll-contain px-3 pb-2"
        style={{ height: `calc(100dvh - ${currentTop}px - ${handleH}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
