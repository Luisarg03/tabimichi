"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";

interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
  banned_until: string | null;
  confirmed: boolean;
}

interface ListResponse {
  users: AdminUser[];
  page: number;
  perPage: number;
  nextPage: number | null;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const btnCls =
  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 min-h-[36px]";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

export default function AdminPage() {
  const { t } = useI18n();
  const { user, getToken } = useAuth();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [page, setPage] = useState(1);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(
    async (p: number, q: string) => {
      const token = await getToken();
      if (!token) return;
      try {
        const res = await fetch(
          `/api/admin/users?page=${p}&perPage=25${q ? `&q=${encodeURIComponent(q)}` : ""}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
          const msg = ((await res.json()) as { error?: string }).error ?? "error";
          setUsers([]);
          setError(msg);
          return;
        }
        const data = (await res.json()) as ListResponse;
        setUsers(data.users);
        setNextPage(data.nextPage);
      } catch {
        setError("error");
        setUsers([]);
      }
    },
    [getToken]
  );

  // Gate: confirm the caller is an admin before showing anything.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token) {
        if (!cancelled) setIsAdmin(false);
        return;
      }
      try {
        const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
        const data = (await res.json()) as { profile?: { role?: string } };
        if (!cancelled) setIsAdmin(data.profile?.role === "admin");
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token || cancelled) return;
      try {
        const res = await fetch(
          `/api/admin/users?page=${page}&perPage=25${appliedQuery ? `&q=${encodeURIComponent(appliedQuery)}` : ""}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (cancelled) return;
        if (!res.ok) {
          const msg = ((await res.json()) as { error?: string }).error ?? "error";
          setUsers([]);
          setError(msg);
          return;
        }
        const data = (await res.json()) as ListResponse;
        setUsers(data.users);
        setNextPage(data.nextPage);
      } catch {
        if (!cancelled) {
          setError("error");
          setUsers([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, page, appliedQuery, getToken]);

  async function act(id: string, body: unknown) {
    setBusy(id);
    setError("");
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "error");
      }
    } catch {
      setError("error");
    } finally {
      setBusy(null);
      load(page, appliedQuery);
    }
  }

  async function remove(id: string, email: string) {
    if (!window.confirm(t("admin.confirmDelete").replace("{email}", email))) return;
    setBusy(id);
    setError("");
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "error");
      }
    } catch {
      setError("error");
    } finally {
      setBusy(null);
      load(page, appliedQuery);
    }
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setAppliedQuery(query.trim());
  }

  if (isAdmin === null) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <span className="animate-pulse text-sm text-slate-400">⏳ Cargando...</span>
      </div>
    );
  }

  if (!isAdmin || !user) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-sm text-slate-600">{t("admin.onlyAdmins")}</p>
        <Link href="/settings" className="text-brand-600 hover:underline">
          {t("admin.backToSettings")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-6xl px-4 py-6 tabi-safe-top tabi-safe-x tabi-safe-bottom">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            ← <span className="ml-1 hidden sm:inline">{t("admin.backToSettings")}</span>
          </Link>
          <h1 className="text-xl font-bold text-slate-900">🛠️ {t("admin.title")}</h1>
        </div>
        <span className="max-w-[200px] truncate text-xs text-slate-500">{user.email}</span>
      </header>

      <main className="mt-6">
        <form onSubmit={search} className="flex max-w-md items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.searchPlaceholder")}
            className={inputCls}
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 min-h-[44px]"
          >
            {t("admin.search")}
          </button>
        </form>

        {error && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
        )}

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">{t("auth.email")}</th>
                <th className="px-4 py-3 font-medium">{t("admin.role")}</th>
                <th className="px-4 py-3 font-medium">{t("admin.registered")}</th>
                <th className="px-4 py-3 font-medium">{t("admin.lastSeen")}</th>
                <th className="px-4 py-3 font-medium">{t("admin.status")}</th>
                <th className="px-4 py-3 font-medium">{t("admin.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">
                      {u.display_name || u.email}
                      {u.id === user.id && <span className="text-slate-400">{t("admin.you")}</span>}
                    </div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.role === "admin"
                          ? "bg-violet-100 text-violet-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{fmtDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{fmtDate(u.last_sign_in_at)}</td>
                  <td className="px-4 py-3 text-xs">
                    {u.banned_until ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700">
                        {t("admin.banned")}
                      </span>
                    ) : !u.confirmed ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
                        {t("admin.unconfirmed")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                        {t("admin.active")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {u.id !== user.id && (
                        <>
                          <button
                            onClick={() =>
                              act(u.id, {
                                action: "set_role",
                                role: u.role === "admin" ? "user" : "admin",
                              })
                            }
                            disabled={busy === u.id}
                            className={`${btnCls} border border-slate-300 text-slate-600 hover:bg-slate-100`}
                          >
                            {u.role === "admin" ? t("admin.demote") : t("admin.promote")}
                          </button>
                          <button
                            onClick={() => act(u.id, { action: u.banned_until ? "unban" : "ban" })}
                            disabled={busy === u.id}
                            className={`${btnCls} border text-white ${
                              u.banned_until
                                ? "border-emerald-600 bg-emerald-600 hover:bg-emerald-500"
                                : "border-amber-600 bg-amber-600 hover:bg-amber-500"
                            }`}
                          >
                            {u.banned_until ? t("admin.unban") : t("admin.ban")}
                          </button>
                          <button
                            onClick={() => remove(u.id, u.email)}
                            disabled={busy === u.id}
                            className={`${btnCls} border border-rose-600 bg-rose-600 text-white hover:bg-rose-500`}
                          >
                            {t("admin.deleteUser")}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {(users ?? []).length === 0 && !error && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    {t("admin.noUsers")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-slate-500">{t("admin.pageInfo").replace("{page}", String(page))}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 min-h-[40px]"
            >
              {t("admin.prev")}
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!nextPage}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 min-h-[40px]"
            >
              {t("admin.next")}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
