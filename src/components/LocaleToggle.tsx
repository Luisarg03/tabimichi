"use client";

import { useI18n, type Locale } from "@/lib/i18n";

export default function LocaleToggle() {
  const { locale, setLocale } = useI18n();
  const opts: Array<{ id: Locale; label: string }> = [
    { id: "es", label: "ES" },
    { id: "en", label: "EN" },
  ];
  return (
    <div className="flex overflow-hidden rounded-full border border-border bg-surface text-xs font-semibold shadow-soft">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => setLocale(o.id)}
          aria-pressed={locale === o.id}
          className={`px-2.5 py-1.5 transition-colors min-h-[36px] ${
            locale === o.id ? "bg-brand-600 text-surface" : "text-muted hover:bg-fg/5 hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
