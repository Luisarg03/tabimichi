"use client";

import Link from "next/link";
import SettingsForm from "@/components/SettingsForm";
import AuthForm from "@/components/AuthForm";
import LocaleToggle from "@/components/LocaleToggle";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";

export default function SettingsPage() {
  const { t } = useI18n();
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <span className="animate-pulse text-sm text-slate-400">⏳ Cargando...</span>
      </div>
    );
  }

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
        <div className="flex items-center gap-2">
          {user && (
            <span className="text-xs text-slate-500">{user.email}</span>
          )}
          <LocaleToggle />
        </div>
      </header>
      <main className="mt-8">
        {!user ? (
          <div className="space-y-6">
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
              <p className="font-medium">🔐 Inicia sesión para gestionar tus API keys</p>
              <p className="mt-1 text-xs text-sky-600">
                Tus keys se guardan de forma segura y solo vos podés verlas.
              </p>
            </div>
            <AuthForm />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div>
                <p className="text-sm font-medium text-emerald-800">
                  ✅ Sesión activa: {user.email}
                </p>
                <p className="mt-0.5 text-xs text-emerald-600">
                  Tus API keys se guardan de forma segura en tu cuenta.
                </p>
              </div>
              <button
                onClick={signOut}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cerrar sesión
              </button>
            </div>
            <SettingsForm />
          </div>
        )}
      </main>
    </div>
  );
}
