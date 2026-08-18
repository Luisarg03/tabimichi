"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";

interface Status {
  googlePlacesApiKey: boolean;
  opencodeApiKey: boolean;
  opencodeGoApiKey: boolean;
  geoapifyApiKey: boolean;
  overpassEndpoint: string;
}

const KEY_FIELDS: Array<{
  key: "googlePlacesApiKey" | "opencodeApiKey" | "opencodeGoApiKey" | "geoapifyApiKey";
  labelKey: string;
  helpKey?: string;
  placeholder: string;
}> = [
  {
    key: "googlePlacesApiKey",
    labelKey: "settings.google",
    helpKey: "settings.googleHelp",
    placeholder: "AIza…",
  },
  { key: "geoapifyApiKey", labelKey: "settings.geoapify", helpKey: "settings.geoapifyHelp", placeholder: "API key (geoapify.com)" },
  { key: "opencodeApiKey", labelKey: "settings.opencodeZen", placeholder: "sk-…" },
  { key: "opencodeGoApiKey", labelKey: "settings.opencodeGo", placeholder: "sk-…" },
];

export default function SettingsForm() {
  const { t } = useI18n();
  const { getToken } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [endpoint, setEndpoint] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken();
        if (!token) return;

        const res = await fetch("/api/user-keys", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;

        const data = await res.json();
        const config = data.config ?? {};

        // Set status (which keys are configured)
        setStatus({
          googlePlacesApiKey: Boolean(config.googlePlacesApiKey),
          opencodeApiKey: Boolean(config.opencodeApiKey),
          opencodeGoApiKey: Boolean(config.opencodeGoApiKey),
          geoapifyApiKey: Boolean(config.geoapifyApiKey),
          overpassEndpoint: config.overpassEndpoint ?? "",
        });
        setEndpoint(config.overpassEndpoint ?? "");
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [getToken]);

  async function save() {
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) return;

      const payload: Record<string, string> = { overpassEndpoint: endpoint.trim() };
      for (const f of KEY_FIELDS) {
        // Only include if user typed something (empty = don't overwrite)
        if (values[f.key]) payload[f.key] = values[f.key];
      }

      const res = await fetch("/api/user-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        // Update status
        setStatus((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          for (const f of KEY_FIELDS) {
            if (values[f.key]) next[f.key] = true;
          }
          next.overpassEndpoint = endpoint.trim();
          return next;
        });
        setValues({});
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  async function clearKey(field: (typeof KEY_FIELDS)[number]["key"]) {
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/user-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [field]: "" }),
      });
      if (res.ok) {
        setStatus((prev) => (prev ? { ...prev, [field]: false } : prev));
        setValues((v) => ({ ...v, [field]: "" }));
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl space-y-5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <p className="text-sm text-slate-600">{t("settings.intro")}</p>

      {KEY_FIELDS.map((f) => (
        <div key={f.key} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-slate-800">{t(f.labelKey)}</label>
            <span className="flex items-center gap-2">
              {status?.[f.key] && (
                <button
                  onClick={() => clearKey(f.key)}
                  disabled={saving}
                  className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                >
                  {t("settings.remove")}
                </button>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  status?.[f.key]
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {status?.[f.key] ? t("settings.connected") : t("settings.notConnected")}
              </span>
            </span>
          </div>
          {f.helpKey && <p className="mt-1 text-xs text-slate-500">{t(f.helpKey)}</p>}
          <input
            type="password"
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            placeholder={status?.[f.key] ? "•••••••• (ya configurada)" : f.placeholder}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
        </div>
      ))}

      {/* custom Overpass endpoint */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-medium text-slate-800">{t("settings.overpass")}</label>
          {status?.overpassEndpoint && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {t("settings.connected")}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">{t("settings.overpassHelp")}</p>
        <input
          type="text"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="http://localhost:8080/api/interpreter"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full rounded-xl bg-brand-600 px-4 py-3.5 font-semibold text-white hover:bg-brand-500 active:bg-brand-700 disabled:opacity-50 min-h-[48px]"
      >
        {saved ? t("settings.saved") : t("settings.save")}
      </button>
    </div>
  );
}
