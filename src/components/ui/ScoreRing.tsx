"use client";

import { ringOffset } from "@/lib/ring";

/** Score ring (prototype .ring): circular progress around a 0–100 score.
 *  sm = 40px (list cards), lg = 72px (detail head). Stroke color follows
 *  the text color (accent by default). */
export default function ScoreRing({
  score,
  size = "sm",
  className = "",
}: {
  score: number;
  size?: "sm" | "lg";
  className?: string;
}) {
  const C = 2 * Math.PI * 15.5;
  const offset = ringOffset(score);
  return (
    <svg
      viewBox="0 0 36 36"
      aria-hidden
      className={`flex-none ${size === "sm" ? "h-10 w-10" : "h-[72px] w-[72px]"} ${className}`}
    >
      <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-fg/10" />
      <circle
        cx="18"
        cy="18"
        r="15.5"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={C.toFixed(1)}
        strokeDashoffset={offset.toFixed(1)}
        transform="rotate(-90 18 18)"
        className="stroke-brand-500"
      />
      <text
        x="18"
        y={size === "sm" ? 21 : 23}
        textAnchor="middle"
        className="fill-fg font-mono text-[10px] font-bold"
      >
        {score}
      </text>
      {size === "lg" && (
        <text x="18" y="30" textAnchor="middle" className="fill-muted font-mono text-[7px]">
          /100
        </text>
      )}
    </svg>
  );
}
