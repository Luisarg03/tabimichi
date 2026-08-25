"use client";

import type { ReactNode } from "react";

/**
 * Inline SVG icon set (prototype tabimichi-redesign sprite). One stroke
 * style everywhere: 24 viewBox, currentColor, round caps/joins.
 * Usage: <Icon name="search" /> — size in px (18 default, 15 for .icon-sm).
 */
const PATHS: Record<string, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  spark: <path d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7Z" />,
  rain: <path d="M12 4c2.5 3.8 5 6.3 5 8.8a5 5 0 0 1-10 0C7 10.3 9.5 7.8 12 4Z" />,
  cloud: (
    <path d="M17.5 19H6.5a4 4 0 0 1 0-8h.3a5.5 5.5 0 0 1 10.6-1.3A3.5 3.5 0 0 1 17.5 19Z" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2m0 15v2M2.5 12h2m15 0h2M5 5l1.4 1.4m11.2 11.2L19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
    </>
  ),
  snow: <path d="M12 3v18M4.2 6.7l15.6 10.6M19.8 6.7 4.2 17.3" />,
  walk: (
    <>
      <circle cx="12" cy="5" r="2.1" />
      <path d="M12 8v6m0 0-2.6 5m2.6-5 2.6 5m-2.6-3-2.4-4m2.4 4 2.4-4" />
    </>
  ),
  train: (
    <>
      <rect x="5" y="4" width="14" height="11" rx="2.5" />
      <path d="M9 4V2.5M15 4V2.5M7 15h10M8.5 19h7" />
      <circle cx="8.5" cy="18" r="1.3" />
      <circle cx="15.5" cy="18" r="1.3" />
      <path d="M9.6 7.5h.01M12 7.5h.01M14.4 7.5h.01" />
    </>
  ),
  car: (
    <>
      <path d="M4 16v2m16-2v2M4 14l1.3-4.2A2 2 0 0 1 7.2 8h9.6a2 2 0 0 1 1.9 1.4L20 14v2h-2M4 14v2h2m14-2v2h-2M4 14h16" />
      <circle cx="8" cy="17.5" r="1.6" />
      <circle cx="16" cy="17.5" r="1.6" />
    </>
  ),
  temple: <path d="M6 21V10m12 11V10M4 10h16M3.5 6.5h17M4.5 10V7.5h15V10" />,
  park: (
    <>
      <path d="M12 21v-7" />
      <path d="M12 14c-3.2 0-5.4-2-5.4-4.6C6.6 6.8 8.9 5 12 5s5.4 1.8 5.4 4.4C17.4 12 15.2 14 12 14Z" />
    </>
  ),
  market: <path d="M3.5 8.5h17M4 8.5c0 3 8 3 8 0 0 3 8 3 8 0M6 8.5V20M18 8.5V20" />,
  nightlife: (
    <>
      <path d="M9 4h6M12 4v2" />
      <path d="M7 6h10l-2.2 13H9.2Z" />
      <path d="M9.5 12h5" />
    </>
  ),
  "thumb-up": (
    <>
      <path d="M7 21H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3" />
      <path d="M7 10 12 3a2 2 0 0 1 2 2v4h4a2 2 0 0 1 2 2l-1.5 7a2 2 0 0 1-2 1.5H7" />
    </>
  ),
  onsen: (
    <>
      <path d="M5 17h14" />
      <path d="M8 14.5c-.3-1.4.5-2.2.5-3.5M12 14.5c-.3-1.4.5-2.2.5-3.5M16 14.5c-.3-1.4.5-2.2.5-3.5" />
    </>
  ),
  viewpoint: (
    <>
      <path d="M3 19h18" />
      <path d="m6 19 4-7 3.5 5 2-3 4.5 5" />
      <circle cx="18" cy="6" r="2" />
    </>
  ),
  food: (
    <>
      <path d="M4 11h16c0 4.4-3.6 8-8 8s-8-3.6-8-8Z" />
      <path d="M8 6.5c0-1 .8-1.5.8-2.5M12 6.5c0-1 .8-1.5.8-2.5M16 6.5c0-1 .8-1.5.8-2.5" />
    </>
  ),
  museum: (
    <>
      <path d="M4 20h16" />
      <path d="m12 3-8 5h16Z" />
      <path d="M6 20v-9h12v9M10 11v9M14 11v9" />
    </>
  ),
  trekking: (
    <>
      <path d="M4 20h16" />
      <path d="m6 20 5-9 3.5 5 2-3 3.5 7" />
      <path d="M13 4.5v6m0-6 4 1.5-4 1.5" />
    </>
  ),
  sakura: (
    <>
      <circle cx="12" cy="6.5" r="2" />
      <circle cx="6.8" cy="10.3" r="2" />
      <circle cx="9.4" cy="16.2" r="2" />
      <circle cx="14.6" cy="16.2" r="2" />
      <circle cx="17.2" cy="10.3" r="2" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  shopping: (
    <>
      <path d="M6 8h12l-1 12H7Z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  "arrow-left": <path d="M19 12H5m0 0 6-6m-6 6 6 6" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.2 2.2m9.8 9.8 2.2 2.2M19.1 4.9l-2.2 2.2m-9.8 9.8-2.2 2.2" />
    </>
  ),
  check: <path d="m5 12 5 5 9-10" />,
  map: (
    <>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14m6-12v14" />
    </>
  ),
};

/** taxonomy experience-type id → icon name (same stroke language). */
export const TYPE_ICONS: Record<string, string> = {
  onsen: "onsen",
  temple: "temple",
  viewpoint: "viewpoint",
  food: "food",
  market: "market",
  museum: "museum",
  park: "park",
  trekking: "trekking",
  sakura: "sakura",
  shopping: "shopping",
  nightlife: "nightlife",
};

export function typeIcon(typeId: string): string {
  return TYPE_ICONS[typeId] ?? "spark";
}

export default function Icon({
  name,
  size = 18,
  className = "",
  strokeWidth = 1.8,
}: {
  name: string;
  /** pixel size (18 = .icon, 15 = .icon-sm) */
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
