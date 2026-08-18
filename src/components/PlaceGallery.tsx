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
      {photoRefs.length > 1 && (
        <>
          <span
            onClick={(e) => {
              e.stopPropagation();
              prev();
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
              next();
            }}
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-xl text-white backdrop-blur-sm transition-colors hover:bg-black/65"
            style={{ cursor: "pointer" }}
            title="→"
          >
            ›
          </span>
          <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
            {activeIdx + 1}/{photoRefs.length}
          </span>
        </>
      )}
    </div>
  );
}
