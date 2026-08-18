"use client";

import { useI18n } from "@/lib/i18n";
import type { WeatherInfo } from "@/lib/types";

function weatherEmoji(condition: string): string {
  if (condition === "clear") return "☀️";
  if (condition === "snow") return "🌨️";
  if (condition === "rain" || condition === "storm") return "🌧️";
  return "☁️";
}

/** Weather display: full card (default) or a single compact row. */
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

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xl">{weatherEmoji(weather.condition)}</span>
          <span className="font-bold text-slate-900">{weather.tempC}°C</span>
          <span className="truncate text-xs text-slate-500">{t(`weather.cond.${weather.label}`)}</span>
        </div>
        <div className="shrink-0 text-right text-xs text-slate-500">
          <div>☔ {todayRain}%</div>
          {tomorrow && (
            <div>
              📅 {tomorrow.minC}°/{tomorrow.maxC}°
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-3xl">{weatherEmoji(weather.condition)}</div>
          <div>
            <div className="text-xl font-bold text-slate-900">{weather.tempC}°C</div>
            <div className="text-xs text-slate-500">
              {t(`weather.cond.${weather.label}`)} · {t("weather.feels", { t: weather.feelsC })}
            </div>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>🌬 {t("weather.wind", { w: weather.windKmh })}</div>
          {weather.precipMm > 0 && <div>💧 {t("weather.precip", { p: weather.precipMm })}</div>}
          {weather.snowCm > 0 && <div>❄️ {t("weather.snow", { s: weather.snowCm })}</div>}
          <div>☔ {t("weather.rainChance", { p: todayRain })}</div>
        </div>
      </div>
      {tomorrow && (
        <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
          📅 {tomorrow.date} · {tomorrow.minC}° / {tomorrow.maxC}° · ☔ {tomorrow.precipProbMax}%
        </div>
      )}
    </div>
  );
}
