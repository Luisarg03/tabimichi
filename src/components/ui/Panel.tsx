import type { HTMLAttributes } from "react";

/** Floating card with the app's standard surface style (Google-Maps-like). */
export default function Panel({
  elevated = false,
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement> & { elevated?: boolean }) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${
        elevated ? "shadow-panel" : ""
      } ${className}`}
      {...rest}
    />
  );
}
