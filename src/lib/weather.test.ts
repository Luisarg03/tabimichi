import { describe, it, expect } from "vitest";
import { classifyWmo, weatherAt } from "@/lib/weather";
import type { WeatherInfo } from "@/lib/types";

describe("classifyWmo", () => {
  it("maps the main conditions", () => {
    expect(classifyWmo(0).condition).toBe("clear");
    expect(classifyWmo(3).condition).toBe("cloudy");
    expect(classifyWmo(51).condition).toBe("rain");
    expect(classifyWmo(71).condition).toBe("snow");
    expect(classifyWmo(95).condition).toBe("storm");
    expect(classifyWmo(45).condition).toBe("fog");
  });

  it("falls back to cloudy for unknown codes", () => {
    expect(classifyWmo(-1).condition).toBe("cloudy");
  });
});

const base: WeatherInfo = {
  tempC: 25,
  feelsC: 27,
  precipMm: 0,
  snowCm: 0,
  windKmh: 5,
  code: 0,
  label: "clear",
  condition: "clear",
  isNight: false,
  hourly: [
    { time: "2026-08-16T09:00", tempC: 23, precipProb: 10, precipMm: 0, snowCm: 0, code: 1 },
    { time: "2026-08-16T03:00", tempC: 22, precipProb: 80, precipMm: 2.5, snowCm: 0, code: 51 },
    { time: "2026-08-17T09:00", tempC: 24, precipProb: 0, precipMm: 0, snowCm: 0, code: 0 },
  ],
  daily: [],
};

describe("weatherAt", () => {
  it("overrides condition/temp with the matching hourly row", () => {
    const sim = weatherAt(base, "2026-08-16T03:00");
    expect(sim.tempC).toBe(22);
    expect(sim.precipMm).toBe(2.5);
    expect(sim.condition).toBe("rain");
    expect(sim.label).toBe("drizzle");
  });

  it("keeps current values when the hour is outside the forecast", () => {
    const sim = weatherAt(base, "2027-01-01T12:00");
    expect(sim).toBe(base);
    expect(sim.condition).toBe("clear");
  });
});
