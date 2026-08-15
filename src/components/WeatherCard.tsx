"use client";

import { useI18n } from "@/lib/i18n";
import type { WeatherInfo } from "@/lib/types";

export default function WeatherCard({ weather }: { weather: WeatherInfo }) {
  const { t } = useI18n();
  const todayRain = Math.max(...weather.hourly.slice(0, 24).map((h) => h.precipProb));
  const tomorrow = weather.daily[1];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-3xl">{weather.condition === "clear" ? "☀️" : weather.condition === "snow" ? "🌨️" : weather.condition === "rain" || weather.condition === "storm" ? "🌧️" : "☁️"}</div>
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
