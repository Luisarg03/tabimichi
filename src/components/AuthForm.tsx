"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";

type Mode = "login" | "register" | "forgot";

export default function AuthForm({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    if (mode === "forgot") {
      const result = await resetPassword(email);
      setLoading(false);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(t("auth.resetSent"));
      }
      return;
    }

    const isLogin = mode === "login";
    let errorMsg: string | undefined;
    let needsConfirmation = false;
    if (isLogin) {
      const r = await signIn(email, password);
      errorMsg = r.error;
    } else {
      const r = await signUp(email, password);
      errorMsg = r.error;
      needsConfirmation = r.needsConfirmation ?? false;
    }

    setLoading(false);

    if (errorMsg) {
      setError(errorMsg);
    } else if (!isLogin && needsConfirmation) {
      setSuccess(t("auth.registerConfirm"));
    } else {
      onDone?.();
    }
  }

  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-center text-lg font-bold text-slate-900">
        {mode === "login" && t("auth.loginTitle")}
        {mode === "register" && t("auth.registerTitle")}
        {mode === "forgot" && t("auth.forgotTitle")}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">{t("auth.email")}</label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            placeholder="tu@email.com"
          />
        </div>

        {mode !== "forgot" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{t("auth.password")}</label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              placeholder={t("auth.passwordMin")}
            />
          </div>
        )}

        {mode === "forgot" && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{t("auth.forgotHint")}</p>
        )}

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
        )}

        {success && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{success}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-500 active:bg-brand-700 disabled:opacity-50 min-h-[48px]"
        >
          {loading
            ? "..."
            : mode === "login"
              ? t("auth.login")
              : mode === "register"
                ? t("auth.register")
                : t("auth.sendReset")}
        </button>
      </form>

      <div className="mt-4 space-y-1.5 text-center text-xs text-slate-500">
        {mode === "login" && (
          <>
            <p>
              {t("auth.noAccount")}{" "}
              <button onClick={() => setMode("register")} className="text-brand-600 hover:underline">
                {t("auth.createOne")}
              </button>
            </p>
            <p>
              <button onClick={() => setMode("forgot")} className="text-brand-600 hover:underline">
                {t("auth.forgot")}
              </button>
            </p>
          </>
        )}
        {mode === "register" && (
          <p>
            {t("auth.haveAccount")}{" "}
            <button onClick={() => setMode("login")} className="text-brand-600 hover:underline">
              {t("auth.loginInstead")}
            </button>
          </p>
        )}
        {mode === "forgot" && (
          <button onClick={() => setMode("login")} className="text-brand-600 hover:underline">
            {t("auth.backToLogin")}
          </button>
        )}
      </div>
    </div>
  );
}
