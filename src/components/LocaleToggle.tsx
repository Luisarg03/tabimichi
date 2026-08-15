"use client";

import { useI18n, type Locale } from "@/lib/i18n";

export default function LocaleToggle() {
  const { locale, setLocale } = useI18n();
  const opts: Array<{ id: Locale; label: string }> = [
    { id: "es", label: "ES" },
    { id: "en", label: "EN" },
  ];
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs font-medium">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => setLocale(o.id)}
          className={`px-2.5 py-1.5 transition-colors ${
            locale === o.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
