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
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 active:bg-slate-100 md:min-h-[40px] md:min-w-[40px] ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
