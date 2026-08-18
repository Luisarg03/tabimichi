"use client";

import { useI18n, type Locale } from "@/lib/i18n";

export default function LocaleToggle() {
  const { locale, setLocale } = useI18n();
  const opts: Array<{ id: Locale; label: string }> = [
    { id: "es", label: "ES" },
    { id: "en", label: "EN" },
  ];
  return (
    <div className="flex overflow-hidden rounded-full border border-slate-300 bg-white text-xs font-medium shadow-sm">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => setLocale(o.id)}
          aria-pressed={locale === o.id}
          className={`px-2.5 py-1.5 transition-colors min-h-[36px] ${
            locale === o.id ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
