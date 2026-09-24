"use client";

import { useEffect, useRef, useState } from "react";
import PlacePhoto from "./PlacePhoto";

/** Swipeable photo gallery (hero). Reused by the place detail panel/sheet. */
export default function PlaceGallery({
  photoRefs,
  placeId,
  alt,
  imgClassName = "h-40 w-full object-cover sm:h-48",
}: {
  photoRefs: string[];
  placeId: string;
  alt: string;
  /** Tailwind classes for the <img> (height/object-fit). */
  imgClassName?: string;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const touchX = useRef<number | null>(null);

  // reset the gallery when the component shows a different place
  useEffect(() => {
    setActiveIdx(0); // eslint-disable-line react-hooks/set-state-in-effect
  }, [placeId]);

  if (photoRefs.length === 0) return null;
  const prev = () => setActiveIdx((i) => (i - 1 + photoRefs.length) % photoRefs.length);
  const next = () => setActiveIdx((i) => (i + 1) % photoRefs.length);

  const navBtn =
    "absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-xl text-white backdrop-blur-sm transition-colors hover:bg-black/65";

  return (
    <div
      className="relative overflow-hidden bg-slate-100"
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (touchX.current ?? 0);
        touchX.current = null;
        if (Math.abs(dx) > 40) {
          e.stopPropagation();
          if (dx > 0) {
            prev();
          } else {
            next();
          }
        }
      }}
    >
      <PlacePhoto
        photoRef={photoRefs[activeIdx]!}
        placeId={placeId}
        alt={alt}
        className={imgClassName}
      />
      {/* preload the neighbors so swiping between photos is instant: PlacePhoto
          fetches + caches the blob on mount, even when display:none */}
      {photoRefs.length > 1 && (
        <div className="hidden" aria-hidden>
          <PlacePhoto
            photoRef={photoRefs[(activeIdx + 1) % photoRefs.length]!}
            placeId={placeId}
            alt=""
          />
          <PlacePhoto
            photoRef={photoRefs[(activeIdx - 1 + photoRefs.length) % photoRefs.length]!}
            placeId={placeId}
            alt=""
          />
        </div>
      )}
      {photoRefs.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            aria-label="←"
            className={`${navBtn} left-2`}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            aria-label="→"
            className={`${navBtn} right-2`}
          >
            ›
          </button>
          <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
            {activeIdx + 1}/{photoRefs.length}
          </span>
        </>
      )}
    </div>
  );
}
