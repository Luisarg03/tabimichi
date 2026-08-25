"use client";

import Icon from "./Icon";

/** Segmented control (prototype .seg): one active option, sliding surface
 *  look. Used for time budget and transport mode. */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
}: {
  options: Array<{ id: T; label: string; icon?: string }>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`grid auto-cols-fr grid-flow-col gap-0.5 rounded-[12px] border border-border bg-fg/5 p-[3px] ${className}`}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-[9px] px-2 py-1.5 text-[13px] font-semibold transition-colors ${
              active
                ? "bg-surface text-fg shadow-[0_1px_3px_oklch(20%_0.02_240/0.16)]"
                : "text-muted hover:text-fg"
            }`}
          >
            {o.icon && <Icon name={o.icon} size={15} className={active ? "text-brand-600" : "text-muted"} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
