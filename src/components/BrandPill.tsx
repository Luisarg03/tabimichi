"use client";

/** Brand pill (prototype .brand-pill): cinnabar seal "旅" + wordmark. */
export default function BrandPill({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border border-border bg-surface/94 px-3 py-2 shadow-soft backdrop-blur-md ${className}`}
    >
      <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-verm font-display text-[15px] font-bold text-surface shadow-[0_2px_6px_oklch(46%_0.16_30/0.35)]">
        旅
      </span>
      <span className="font-display text-[15px] font-bold tracking-[-0.01em] text-fg">
        Tabimichi{" "}
        <small className="ml-0.5 text-[12px] font-medium text-muted">旅道</small>
      </span>
    </div>
  );
}
