import type { ButtonHTMLAttributes } from "react";

/** Pill chip (category filter / preset), with a selected state. */
export default function Chip({
  selected = false,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      className={`inline-flex min-h-[36px] items-center gap-1 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${
        selected
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100"
      } ${className}`}
      {...rest}
    />
  );
}
