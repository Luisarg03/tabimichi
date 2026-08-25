"use client";

import type { PlaceProfile, RecommendResult, ScoredPlace } from "@/lib/types";
import { EXPERIENCE_TYPES } from "@/lib/places/taxonomy";
import { useI18n } from "@/lib/i18n";
import RecommendationCard from "@/components/RecommendationCard";
import WeatherCard from "@/components/WeatherCard";
import Icon, { typeIcon } from "@/components/ui/Icon";

/** Shared results content: weather, notices, "Tus gustos", guide summary and
 *  the compact place list. Rendered inside the desktop left rail and the
 *  mobile bottom sheet. */
export default function ResultsList({
  loading,
  error,
  result,
  profile,
  selectedId,
  onSelect,
  tastesOpen,
  onTastesToggle,
  onTaste,
  onTasteReset,
  onNarrate,
  guideState,
  simCtx,
}: {
  loading: boolean;
  error: boolean;
  result: RecommendResult | null;
  profile: PlaceProfile | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  tastesOpen: boolean;
  onTastesToggle: () => void;
  onTaste: (tag: string, delta: number) => void;
  onTasteReset: () => void;
  onNarrate: () => void;
  guideState: "idle" | "thinking" | "done";
  /** results header context, e.g. "Ahora · 15:00 JST" */
  simCtx?: string;
}) {
  const { t } = useI18n();
  // Merged discovery: a combined label when several sources contributed
  // (e.g. "Datos: Google Places + OpenStreetMap"), the plain label otherwise.
  const multiSources = (result?.sources?.length ?? 0) > 1;
  const sourceLabel = multiSources
    ? t("panel.source.multi", {
        sources: result!.sources!.map((s) => t(`panel.sourceName.${s}`)).join(" + "),
      })
    : result
      ? t(`panel.source.${result.sourceNote}`)
      : "";

  return (
    <div className="space-y-2">
      {loading && (
        <div className="rounded-panel border border-border bg-surface p-4 text-center text-sm text-muted shadow-soft">
          <span className="inline-block animate-pulse">⏳ {t("status.discovering")}</span>
        </div>
      )}

      {error && (
        <div className="rounded-panel border border-bad/30 bg-bad-soft p-4 text-sm text-bad shadow-soft">
          {t("status.error")}
        </div>
      )}

      {result && !loading && (
        <>
          <WeatherCard weather={result.weather} compact />
          {result.keywordMiss && (
            <div className="rounded-panel border border-warn/40 bg-warn-soft p-4 text-sm text-warn shadow-soft">
              {t("status.keywordMiss", { kw: result.keyword ?? "" })}
            </div>
          )}

          {/* results header */}
          <div className="flex items-baseline justify-between gap-2 px-0.5 pt-2">
            <h2 className="font-display text-[16px] font-bold tracking-[-0.01em] text-fg">
              {t("sheet.placesCount", { n: result.places.length })}
            </h2>
            {simCtx && <span className="mono text-[12.5px] text-muted">{simCtx}</span>}
          </div>
          {result.sourceNote !== "none" && (
            <div className="flex items-center gap-1.5 px-0.5 text-[11.5px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
              {sourceLabel}
            </div>
          )}

          {/* Tus gustos: manage the learned profile */}
          <button
            onClick={onTastesToggle}
            className="flex w-full items-center justify-between rounded-panel border border-border bg-surface px-3 py-2.5 text-[13px] font-semibold text-fg shadow-soft transition-colors hover:bg-fg/5 active:bg-fg/10 min-h-[44px]"
          >
            <span className="flex items-center gap-1.5">
              <Icon
                name="chevron-down"
                size={15}
                className={`text-muted transition-transform ${tastesOpen ? "rotate-180" : ""}`}
              />
              {t("profile.title")}
            </span>
            {profile && Object.values(profile).some((w) => w !== 0) && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-brand-600">
                {Object.entries(profile).filter(([, w]) => w !== 0).length}
              </span>
            )}
          </button>
          {tastesOpen && (
            <div className="rounded-panel border border-border bg-surface p-3 shadow-soft">
              <p className="mb-2 text-xs text-muted">{t("profile.hint")}</p>
              <div className="grid grid-cols-2 gap-2">
                {EXPERIENCE_TYPES.map((type) => {
                  const w = profile?.[type.id] ?? 0;
                  return (
                    <div
                      key={type.id}
                      className="flex items-center justify-between gap-2 rounded-[10px] bg-fg/5 py-1.5 pl-2.5 pr-1.5"
                    >
                      <span className="mr-1 truncate text-[12.5px] font-semibold text-fg">
                        {t(`panel.type.${type.id}`)}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5">
                        <button
                          onClick={() => onTaste(type.id, -1)}
                          disabled={w <= -5}
                          aria-label={`${t(`panel.type.${type.id}`)} −`}
                          className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-border bg-surface text-[15px] font-semibold text-fg transition-colors hover:bg-fg/5 disabled:opacity-35"
                        >
                          <Icon name="minus" size={13} />
                        </button>
                        <span
                          className={`mono w-[26px] text-center text-[12.5px] font-bold ${
                            w > 0 ? "text-ok" : w < 0 ? "text-bad" : "text-muted"
                          }`}
                        >
                          {w > 0 ? `+${w}` : w}
                        </span>
                        <button
                          onClick={() => onTaste(type.id, 1)}
                          disabled={w >= 5}
                          aria-label={`${t(`panel.type.${type.id}`)} +`}
                          className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-border bg-surface text-[15px] font-semibold text-fg transition-colors hover:bg-fg/5 disabled:opacity-35"
                        >
                          <Icon name="plus" size={13} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={onTasteReset}
                className="mt-2 w-full min-h-[40px] rounded-[12px] border border-bad/30 bg-bad-soft px-3 py-2 text-xs font-medium text-bad transition-colors hover:bg-bad/15 active:bg-bad/20"
              >
                {t("profile.reset")}
              </button>
            </div>
          )}

          {result.sourceNote === "none" ? (
            <div className="rounded-panel border border-warn/40 bg-warn-soft p-4 text-sm text-warn shadow-soft">
              {t(`panel.source.${result.sourceNote}`)}
            </div>
          ) : (
            <>
              {result.places.length > 0 && (
                <button
                  onClick={onNarrate}
                  disabled={guideState === "thinking"}
                  className="flex w-full min-h-[40px] items-center justify-center gap-2 rounded-[12px] border border-border bg-surface text-[13px] font-semibold text-fg transition-colors hover:bg-fg/5 active:bg-fg/10 disabled:opacity-55"
                >
                  <Icon name="spark" size={15} className="text-brand-600" />
                  {guideState === "thinking"
                    ? t("status.guideThinking")
                    : result.narrated
                      ? t("card.guideRegenerate")
                      : t("card.guideButton")}
                </button>
              )}
              {guideState === "thinking" && !result.summary && (
                <div className="rounded-panel border border-brand-500/25 bg-accent-soft p-4 text-sm text-fg shadow-soft">
                  <span className="inline-flex items-center gap-2 animate-pulse">
                    <Icon name="spark" size={15} className="text-brand-600" />
                    {t("status.guideThinking")}
                  </span>
                </div>
              )}
              {result.summary && (
                <div className="rounded-panel border border-brand-500/25 bg-accent-soft p-3 text-sm text-fg">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-brand-600">
                      <Icon name="spark" size={13} />
                      {t("card.summaryTitle")}
                    </span>
                    {result.narratedBy && (
                      <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-medium text-brand-600">
                        {result.narratedBy === "opencode-go" ? t("card.narrator.paid") : t("card.narrator.free")}
                      </span>
                    )}
                  </div>
                  {result.summary}
                </div>
              )}
              {result.places.length === 0 ? (
                <div className="rounded-panel border border-dashed border-border p-6 text-center text-[13px] text-muted">
                  {result.emptyReason === "all_closed"
                    ? t("status.emptyClosed")
                    : result.emptyReason === "too_far"
                      ? t("status.emptyFar")
                      : t("status.empty")}
                </div>
              ) : (
                <>
                  {profile && Object.keys(profile).some((k) => profile[k] !== 0) && (
                    <div className="rounded-panel border border-ok/20 bg-ok-soft px-4 py-2 text-xs text-fg">
                      <span className="font-medium text-ok">{t("profile.title")}: </span>
                      {Object.entries(profile)
                        .filter(([, w]) => w !== 0)
                        .map(([tag, w]) => (
                          <span key={tag} className="mr-2 inline-flex items-center gap-1">
                            <Icon name={typeIcon(tag)} size={13} className="text-muted" />
                            {t(`panel.type.${tag}`)}
                            <span className={w > 0 ? "font-semibold text-ok" : "font-semibold text-bad"}>
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
        <div className="rounded-panel border border-dashed border-border bg-surface/70 p-6 text-center text-[13px] text-muted">
          {t("app.tagline")} 🌸
        </div>
      )}
    </div>
  );
}
