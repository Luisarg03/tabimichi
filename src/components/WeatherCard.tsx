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

/** Weather display: compact strip (prototype .weather-strip). */
export default function WeatherCard({
  weather,
}: {
  weather: WeatherInfo;
}) {
  const { t } = useI18n();
  const todayRain = Math.max(...weather.hourly.slice(0, 24).map((h) => h.precipProb));
  const tomorrow = weather.daily[1];
  // 6-bar sparkline of the next hours' rain probability (current hour = last,
  // drawn in accent — prototype .spark)
  const spark = weather.hourly.slice(0, 6).map((h) => h.precipProb);

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
