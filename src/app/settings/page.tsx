"use client";

import Link from "next/link";
import { useState } from "react";
import SettingsForm from "@/components/SettingsForm";
import AuthForm from "@/components/AuthForm";
import AccountPanel from "@/components/AccountPanel";
import LocaleToggle from "@/components/LocaleToggle";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";

/** Shown when the user arrives through a password-recovery link. */
function RecoveryForm() {
  const { t } = useI18n();
  const { updatePassword } = useAuth();
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    if (pwd1.length < 8) {
      setError(t("account.passwordTooShort"));
      return;
    }
    if (pwd1 !== pwd2) {
      setError(t("account.passwordsMismatch"));
      return;
    }
    setLoading(true);
    const res = await updatePassword(pwd1);
    setLoading(false);
    if (res.error) {
      setError(res.error);
    } else {
      setMsg(t("account.passwordChanged"));
      setPwd1("");
      setPwd2("");
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-brand-100 bg-brand-50 p-6">
      <h2 className="text-lg font-bold text-slate-900">{t("account.recoveryTitle")}</h2>
      <p className="mt-1 text-sm text-slate-600">{t("account.recoveryHint")}</p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <input
          type="password"
          required
          minLength={8}
          value={pwd1}
          onChange={(e) => setPwd1(e.target.value)}
          placeholder={t("account.newPassword")}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
        <input
          type="password"
          required
          minLength={8}
          value={pwd2}
          onChange={(e) => setPwd2(e.target.value)}
          placeholder={t("account.confirmPassword")}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
        {error && <p className="text-xs text-rose-700">{error}</p>}
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        <button
          type="submit"
          disabled={loading || !pwd1 || !pwd2}
          className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-500 active:bg-brand-700 disabled:opacity-50 min-h-[48px]"
        >
          {loading ? "..." : t("account.setPassword")}
        </button>
      </form>
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  const { user, profile, loading, signOut, recoveryMode } = useAuth();

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <span className="animate-pulse text-sm text-slate-400">⏳ Cargando...</span>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-6xl px-4 py-6 tabi-safe-top tabi-safe-x tabi-safe-bottom">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 active:bg-slate-100"
            aria-label={t("nav.back")}
          >
            ← <span className="ml-1 hidden sm:inline">{t("nav.back")}</span>
          </Link>
          <h1 className="text-xl font-bold text-slate-900">⚙️ {t("settings.title")}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user && (
            <span className="max-w-[200px] truncate text-xs text-slate-500">{user.email}</span>
          )}
          {profile?.role === "admin" && (
            <Link
              href="/admin"
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              🛠️ {t("admin.title")}
            </Link>
          )}
          <LocaleToggle />
        </div>
      </header>
      <main className="mt-8">
        {!user ? (
          <div className="space-y-6">
            <div className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-900">
              <p className="font-medium">{t("auth.needLoginForKeys")}</p>
              <p className="mt-1 text-xs text-brand-700">{t("auth.needLoginForKeysHint")}</p>
            </div>
            <AuthForm />
          </div>
        ) : (
          <div className="space-y-4">
            {recoveryMode && <RecoveryForm />}
            <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div>
                <p className="text-sm font-medium text-emerald-800">
                  {t("auth.sessionActive").replace("{email}", user.email ?? "")}
                </p>
                <p className="mt-0.5 text-xs text-emerald-600">{t("auth.sessionActiveHint")}</p>
              </div>
              <button
                onClick={signOut}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 active:bg-slate-100 min-h-[40px]"
              >
                {t("auth.signOut")}
              </button>
            </div>
            <AccountPanel />
            <SettingsForm />
          </div>
        )}
      </main>
    </div>
  );
}
