import type { WeatherInfo, WeatherCondition } from "./types";

/** Map a WMO weather code to a coarse condition + human label key. */
export function classifyWmo(code: number): { condition: WeatherCondition; label: string } {
  if (code === 0) return { condition: "clear", label: "clear" };
  if (code >= 1 && code <= 3) return { condition: "cloudy", label: "cloudy" };
  if (code === 45 || code === 48) return { condition: "fog", label: "fog" };
  if (code >= 51 && code <= 67) return { condition: "rain", label: "drizzle" };
  if (code >= 71 && code <= 77) return { condition: "snow", label: "snow" };
  if (code >= 80 && code <= 82) return { condition: "rain", label: "showers" };
  if (code >= 85 && code <= 86) return { condition: "snow", label: "snow_showers" };
  if (code >= 95) return { condition: "storm", label: "thunderstorm" };
  return { condition: "cloudy", label: "cloudy" };
}

interface OpenMeteoResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    precipitation: number;
    snowfall: number;
    weather_code: number;
    wind_speed_10m: number;
    is_day: number;
  };
  hourly: {
    time: string[];
    precipitation_probability: number[];
    precipitation: number[];
    snowfall: number[];
    weather_code: number[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
}

export async function getWeather(lat: number, lng: number): Promise<WeatherInfo> {
  const url =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      current:
        "temperature_2m,apparent_temperature,precipitation,snowfall,weather_code,wind_speed_10m,is_day",
      hourly:
        "precipitation_probability,precipitation,snowfall,weather_code",
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "auto",
      forecast_days: "3",
    });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  const data = (await res.json()) as OpenMeteoResponse;

  const { condition, label } = classifyWmo(data.current.weather_code);
  const hourly = data.hourly.time.map((t, i) => ({
    time: t,
    precipProb: data.hourly.precipitation_probability[i] ?? 0,
    precipMm: data.hourly.precipitation[i] ?? 0,
    snowCm: data.hourly.snowfall[i] ?? 0,
    code: data.hourly.weather_code[i] ?? 0,
  }));

  const daily = data.daily.time.map((t, i) => ({
    date: t,
    code: data.daily.weather_code[i] ?? 0,
    maxC: data.daily.temperature_2m_max[i] ?? 0,
    minC: data.daily.temperature_2m_min[i] ?? 0,
    precipProbMax: data.daily.precipitation_probability_max[i] ?? 0,
  }));

  return {
    tempC: data.current.temperature_2m,
    feelsC: data.current.apparent_temperature,
    precipMm: data.current.precipitation,
    snowCm: data.current.snowfall,
    windKmh: data.current.wind_speed_10m,
    code: data.current.weather_code,
    label,
    condition,
    isNight: data.current.is_day === 0,
    hourly,
    daily,
  };
}
