import type { ButtonHTMLAttributes } from "react";

/** Pill chip (category filter / preset / vibe), with a selected state.
 *  Active = accent-soft fill + accent border + accent text (prototype
 *  .vibe-chip.active). */
export default function Chip({
  selected = false,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      className={`inline-flex min-h-[36px] items-center gap-1 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors ${
        selected
          ? "border-brand-500/45 bg-accent-soft text-brand-600"
          : "border-border bg-surface text-fg hover:border-fg/30 active:bg-fg/5"
      } ${className}`}
      {...rest}
    />
  );
}
