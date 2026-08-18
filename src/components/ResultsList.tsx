"use client";

import type { PlaceProfile, RecommendResult, ScoredPlace } from "@/lib/types";
import { EXPERIENCE_TYPES, EXPERIENCE_TYPE_MAP } from "@/lib/places/taxonomy";
import { useI18n } from "@/lib/i18n";
import RecommendationCard from "@/components/RecommendationCard";
import WeatherCard from "@/components/WeatherCard";

/** Shared results content: weather, notices, "Tus gustos", guide summary and
 *  the compact place list. Rendered inside the desktop left column and the
 *  mobile bottom sheet. */
export default function ResultsList({
  loading,
  error,
  result,
  profile,
  mode,
  selectedId,
  onSelect,
  tastesOpen,
  onTastesToggle,
  onTaste,
  onTasteReset,
  onNarrate,
  guideState,
}: {
  loading: boolean;
  error: boolean;
  result: RecommendResult | null;
  profile: PlaceProfile | null;
  mode: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  tastesOpen: boolean;
  onTastesToggle: () => void;
  onTaste: (tag: string, delta: number) => void;
  onTasteReset: () => void;
  onNarrate: () => void;
  guideState: "idle" | "thinking" | "done";
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-2">
      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 shadow-sm">
          <span className="inline-block animate-pulse">⏳ {t("status.discovering")}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow-sm">
          {t("status.error")}
        </div>
      )}

      {result && !loading && (
        <>
          <WeatherCard weather={result.weather} compact />
          {result.keywordMiss && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
              {t("status.keywordMiss", { kw: result.keyword ?? "" })}
            </div>
          )}

          {/* Tus gustos: manage the learned profile */}
          <button
            onClick={onTastesToggle}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 active:bg-slate-100 min-h-[44px]"
          >
            {tastesOpen ? "▾ " : "▸ "}
            {t("profile.title")}
            {profile && Object.values(profile).some((w) => w !== 0) && (
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                {Object.entries(profile).filter(([, w]) => w !== 0).length}
              </span>
            )}
          </button>
          {tastesOpen && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="mb-2 text-xs text-slate-500">{t("profile.hint")}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {EXPERIENCE_TYPES.map((type) => {
                  const w = profile?.[type.id] ?? 0;
                  return (
                    <div
                      key={type.id}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5"
                    >
                      <span className="mr-1 truncate text-xs text-slate-700">
                        {type.emoji} {t(`panel.type.${type.id}`)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => onTaste(type.id, -1)}
                          disabled={w <= -5}
                          aria-label={`${t(`panel.type.${type.id}`)} −`}
                          className="h-8 w-8 rounded-md border border-slate-300 text-sm leading-none text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-30 min-h-[32px] min-w-[32px]"
                        >
                          −
                        </button>
                        <span
                          className={`w-6 text-center text-xs font-semibold ${
                            w > 0 ? "text-emerald-600" : w < 0 ? "text-rose-500" : "text-slate-400"
                          }`}
                        >
                          {w}
                        </span>
                        <button
                          onClick={() => onTaste(type.id, 1)}
                          disabled={w >= 5}
                          aria-label={`${t(`panel.type.${type.id}`)} +`}
                          className="h-8 w-8 rounded-md border border-slate-300 text-sm leading-none text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-30 min-h-[32px] min-w-[32px]"
                        >
                          +
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={onTasteReset}
                className="mt-2 w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100 active:bg-rose-200 min-h-[40px]"
              >
                {t("profile.reset")}
              </button>
            </div>
          )}

          {result.sourceNote === "none" ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
              {t(`panel.source.${result.sourceNote}`)}
            </div>
          ) : (
            <>
              <div className="text-xs text-slate-500">{t(`panel.source.${result.sourceNote}`)}</div>
              {result.places.length > 0 && (
                <button
                  onClick={onNarrate}
                  disabled={guideState === "thinking"}
                  className="w-full rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 shadow-sm transition-colors hover:bg-sky-100 active:bg-sky-200 disabled:opacity-50 sm:w-full sm:py-3 sm:text-sm"
                >
                  🧠{" "}
                  {guideState === "thinking"
                    ? t("status.guideThinking")
                    : result.narrated
                      ? t("card.guideRegenerate")
                      : t("card.guideButton")}
                </button>
              )}
              {guideState === "thinking" && !result.summary && (
                <div className="rounded-xl border border-sky-100 bg-sky-50 p-4 text-sm text-slate-500 shadow-sm">
                  <span className="inline-block animate-pulse">🧠 {t("status.guideThinking")}</span>
                </div>
              )}
              {result.summary && (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-800 shadow-sm">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-sky-500">
                      {t("card.summaryTitle")}
                    </span>
                    {result.narratedBy && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-600">
                        {result.narratedBy === "opencode-go" ? t("card.narrator.paid") : t("card.narrator.free")}
                      </span>
                    )}
                  </div>
                  {result.summary}
                </div>
              )}
              {result.places.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
                  {result.emptyReason === "all_closed"
                    ? t("status.emptyClosed")
                    : result.emptyReason === "too_far"
                      ? t("status.emptyFar")
                      : t("status.empty")}
                </div>
              ) : (
                <>
                  {profile && Object.keys(profile).some((k) => profile[k] !== 0) && (
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-xs text-slate-600 shadow-sm">
                      <span className="font-medium text-emerald-700">{t("profile.title")}: </span>
                      {Object.entries(profile)
                        .filter(([, w]) => w !== 0)
                        .map(([tag, w]) => (
                          <span key={tag} className="mr-2 inline-flex items-center gap-1">
                            {EXPERIENCE_TYPE_MAP[tag]?.emoji ?? ""}
                            {t(`panel.type.${tag}`)}
                            <span className={w > 0 ? "text-emerald-600" : "text-rose-500"}>
                              {w > 0 ? `+${w}` : w}
                            </span>
                          </span>
                        ))}
                    </div>
                  )}
                  <div className="space-y-2">
                    {result.places.map((p: ScoredPlace) => (
                      <RecommendationCard
                        key={p.id}
                        place={p}
                        mode={mode}
                        selected={selectedId === p.id}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {!result && !loading && !error && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-sm text-slate-400 shadow-sm">
          {t("app.tagline")} 🌸
        </div>
      )}
    </div>
  );
}
