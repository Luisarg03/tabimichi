"use client";

import { useI18n } from "@/lib/i18n";
import type { WeatherInfo } from "@/lib/types";
import Icon from "@/components/ui/Icon";

function weatherIcon(condition: string): string {
  if (condition === "clear") return "sun";
  if (condition === "snow") return "snow";
  if (condition === "rain" || condition === "storm") return "rain";
  return "cloud";
}

/** Weather display: compact strip (prototype .weather-strip) or full card. */
export default function WeatherCard({
  weather,
  compact = false,
}: {
  weather: WeatherInfo;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const todayRain = Math.max(...weather.hourly.slice(0, 24).map((h) => h.precipProb));
  const tomorrow = weather.daily[1];
  // 6-bar sparkline of the next hours' rain probability (current hour = last,
  // drawn in accent — prototype .spark)
  const spark = weather.hourly.slice(0, 6).map((h) => h.precipProb);

  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-panel border border-border bg-surface/80 px-3 py-2.5">
        <Icon name={weatherIcon(weather.condition)} size={30} className="text-muted" />
        <div className="min-w-0">
          <div className="font-display text-[26px] font-bold leading-none tracking-[-0.02em] text-fg">
            {weather.tempC}°
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <b className="text-[13px] font-semibold text-fg">{t(`weather.cond.${weather.label}`)}</b>
            <span className="text-[12px] text-muted">{t("weather.feels", { t: weather.feelsC })}</span>
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="flex items-center justify-end gap-1 text-[12px] font-semibold text-brand-600">
            <Icon name="rain" size={15} />
            {todayRain}%
          </div>
          {tomorrow && (
            <div className="mt-0.5 text-[11.5px] text-muted">
              {t("weather.tomorrow", {
                min: tomorrow.minC,
                max: tomorrow.maxC,
              })}
            </div>
          )}
          <div className="mt-1 flex h-[22px] items-end justify-end gap-[3px]" aria-hidden>
            {spark.map((p, i) => (
              <i
                key={i}
                className={`block w-[5px] rounded-[2px] ${i === spark.length - 1 ? "bg-brand-500" : "bg-brand-500/25"}`}
                style={{ height: `${Math.max(14, Math.round(p))}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-panel border border-border bg-surface p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon name={weatherIcon(weather.condition)} size={36} className="text-muted" />
          <div>
            <div className="font-display text-[26px] font-bold leading-none text-fg">{weather.tempC}°</div>
            <div className="mt-1 text-xs text-muted">
              {t(`weather.cond.${weather.label}`)} · {t("weather.feels", { t: weather.feelsC })}
            </div>
          </div>
        </div>
        <div className="text-right text-xs text-muted">
          <div>{t("weather.wind", { w: weather.windKmh })}</div>
          {weather.precipMm > 0 && <div>{t("weather.precip", { p: weather.precipMm })}</div>}
          {weather.snowCm > 0 && <div>{t("weather.snow", { s: weather.snowCm })}</div>}
          <div className="text-brand-600">{t("weather.rainChance", { p: todayRain })}</div>
        </div>
      </div>
      {tomorrow && (
        <div className="mt-3 border-t border-border pt-2 text-xs text-muted">
          📅 {tomorrow.date} · {tomorrow.minC}° / {tomorrow.maxC}° · ☔ {tomorrow.precipProbMax}%
        </div>
      )}
    </div>
  );
}
