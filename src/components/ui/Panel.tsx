import type { HTMLAttributes } from "react";

/** Floating card with the app's standard surface style. */
export default function Panel({
  elevated = false,
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement> & { elevated?: boolean }) {
  return (
    <div
      className={`rounded-panel border border-border bg-surface ${elevated ? "shadow-panel" : "shadow-soft"} ${className}`}
      {...rest}
    />
  );
}
