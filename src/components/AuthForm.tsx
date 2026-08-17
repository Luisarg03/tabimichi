"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

type Mode = "login" | "register";

export default function AuthForm({ onDone }: { onDone?: () => void }) {
  const { signIn, signUp } = useAuth();
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

    const fn = mode === "login" ? signIn : signUp;
    const result = await fn(email, password);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else if (mode === "register") {
      setSuccess("Cuenta creada. Revisa tu email para confirmar.");
    } else {
      onDone?.();
    }
  }

  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-center text-lg font-bold text-slate-900">
        {mode === "login" ? "🔑 Iniciar sesión" : "🆕 Crear cuenta"}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            placeholder="tu@email.com"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Contraseña</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            placeholder="mínimo 6 caracteres"
          />
        </div>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
        )}

        {success && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{success}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? "..." : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-slate-500">
        {mode === "login" ? (
          <>
            ¿No tenés cuenta?{" "}
            <button onClick={() => setMode("register")} className="text-sky-600 hover:underline">
              Crear una
            </button>
          </>
        ) : (
          <>
            ¿Ya tenés cuenta?{" "}
            <button onClick={() => setMode("login")} className="text-sky-600 hover:underline">
              Iniciar sesión
            </button>
          </>
        )}
      </p>
    </div>
  );
}
