import type { ButtonHTMLAttributes } from "react";

/** Round icon button — requires an accessible label (aria-label + title). */
export default function IconButton({
  label,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border bg-surface text-fg shadow-soft transition-colors hover:bg-fg/5 active:bg-fg/10 md:min-h-[40px] md:min-w-[40px] ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
