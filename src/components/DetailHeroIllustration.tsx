"use client";

/** Abstract hero (prototype .detail-hero): indigo→cinnabar gradient with a
 *  sun, mountain ridge and torii gate. Used as the detail fallback when the
 *  place has no photos. Children (e.g. the close button) render on top. */
export default function DetailHeroIllustration({
  className = "",
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`relative bg-[linear-gradient(180deg,oklch(36%_0.08_258),oklch(48%_0.10_40)_58%,oklch(58%_0.13_45))] ${className}`}
    >
      <svg
        viewBox="0 0 388 168"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
        className="absolute inset-0 h-full w-full"
      >
        <circle className="fill-[oklch(88%_0.12_75)] opacity-90" cx="290" cy="86" r="26" />
        <path
          className="fill-[oklch(26%_0.03_262)] opacity-60"
          d="M0 132 L70 96 L130 128 L210 88 L300 132 L388 100 L388 168 L0 168 Z"
        />
        <g className="fill-[oklch(21%_0.02_265)]">
          <rect x="150" y="84" width="8" height="70" />
          <rect x="234" y="84" width="8" height="70" />
          <path d="M128 84 C 150 72, 242 72, 264 84 L 262 92 L 130 92 Z" />
          <rect x="140" y="104" width="112" height="7" />
        </g>
      </svg>
      {children}
    </div>
  );
}
