"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

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
  const [status, setStatus] = useState<Status | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [endpoint, setEndpoint] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: Status) => {
        setStatus(s);
        setEndpoint(s.overpassEndpoint ?? "");
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    const payload: Record<string, string> = { overpassEndpoint: endpoint.trim() };
    for (const f of KEY_FIELDS) if (values[f.key]) payload[f.key] = values[f.key];
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const s = (await res.json()) as Status;
      setStatus(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <p className="text-sm text-slate-600">{t("settings.intro")}</p>

      {KEY_FIELDS.map((f) => (
        <div key={f.key} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-slate-800">{t(f.labelKey)}</label>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                status?.[f.key]
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {status?.[f.key] ? t("settings.connected") : t("settings.notConnected")}
            </span>
          </div>
          {f.helpKey && <p className="mt-1 text-xs text-slate-500">{t(f.helpKey)}</p>}
          <input
            type="password"
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            placeholder={f.placeholder}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          />
        </div>
      ))}

      {/* custom Overpass endpoint (self-hosted osm3s) */}
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
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        />
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full rounded-xl bg-sky-600 px-4 py-3 font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {saved ? t("settings.saved") : t("settings.save")}
      </button>
    </div>
  );
}
