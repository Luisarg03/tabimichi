"use client";

import Link from "next/link";
import SettingsForm from "@/components/SettingsForm";
import LocaleToggle from "@/components/LocaleToggle";
import { useI18n } from "@/lib/i18n";

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← {t("nav.back")}
          </Link>
          <h1 className="text-xl font-bold text-slate-900">⚙️ {t("settings.title")}</h1>
        </div>
        <LocaleToggle />
      </header>
      <main className="mt-8">
        <SettingsForm />
      </main>
    </div>
  );
}
