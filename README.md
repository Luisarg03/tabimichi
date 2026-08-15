# Tabi 旅 — Discover what to do today

Tabi is a local discovery app: tell it **where you are** and **how much time you
have**, and it recommends nearby places to explore — ranked by weather, distance,
time budget and your mood. It's a personal travel guide, not a hardcoded
itinerary: every recommendation is discovered live from real data sources.

> Status: **M1 (MVP)** — discovery + weather + scoring + map, running locally on
> desktop. LLM narrative (M2), feedback profile (M3) and mobile PWA (M5) are
> next.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Production:

```bash
npm run build
npm start          # http://localhost:3000
```

## How it works

```
Where are you? + time budget + mood/type
        ↓
  /api/recommend (pipeline)
        ↓
  Weather (Open-Meteo, free) ──┐
  Discovery (Google Places │
    → fallback OSM Overpass)   ├─→ rule-based scoring (fit score + why)
  Time/distance (haversine) ───┘        ↓
  Cards + map with "why now" reasons
```

- **Weather** — [Open-Meteo](https://open-meteo.com): free, no API key, hourly
  forecast (rain, snow, wind, probability). Rain boosts indoor types (onsen,
  museum, food…), clear skies boost viewpoints/parks/hiking.
- **Discovery** — Google Places Text Search when an API key is configured;
  otherwise OpenStreetMap via Overpass (mirror failover + retries, best-effort).
  Results are cached in SQLite (`data/tabi.db`).
- **Scoring** — rule-based "base fit" score (0–100): travel time vs. budget,
  weather fit, rating, open-now status. The LLM (next phase) narrates the *why*,
  it doesn't score.
- **Storage** — `node:sqlite` (built into Node ≥ 22.5, no native deps):
  place cache + (later) user profile & feedback.

## Settings / API keys

Open **⚙️ Ajustes** in the app or edit `data/config.json` directly (gitignored).
Keys never leave your machine; environment variables override the file.

| Key | Env var | Purpose |
|-----|---------|---------|
| Google Places | `GOOGLE_PLACES_API_KEY` | Rich discovery: ratings, hours, photos (needs Google billing). |
| OpenCode Zen | `OPENCODE_API_KEY` | LLM guide — next phase (M2). |
| OpenCode Go | `OPENCODE_GO_API_KEY` | LLM guide — next phase (M2). |

Without a Google key the app works with OpenStreetMap (free). Note: public
Overpass instances are shared and can be slow or overloaded; the app degrades
gracefully (local cache, or a clear "data unavailable" message).

## Tech stack

- **Next.js 16** (App Router) + TypeScript + Tailwind CSS v4
- **Leaflet + react-leaflet** with OpenStreetMap tiles (free, no key)
- **node:sqlite** — zero-dependency local cache
- **i18n** ES / EN (built-in dictionaries)

## Roadmap

| Milestone | Scope |
|-----------|-------|
| **M1 ✅** | Discovery (Google/Overpass), weather, scoring, map, i18n, settings |
| M2 | `lib/llm/` connection module (provider registry, API key via Settings) + narrative "why" + conversational mode |
| M3 | Feedback loop: 👍/👎 per card → tag profile → weighted scoring |
| M4 | Taste onboarding quiz + general season layer (sakura/snow/festivals by location & date) |
| M5 | PWA + mobile |

## Project layout

```
src/
  app/            pages + API routes (/api/recommend, /weather, /places, /settings, /geocode)
  components/     MapView, DayPanel, RecommendationCard, WeatherCard, SettingsForm…
  lib/
    i18n.tsx      ES/EN dictionaries + provider
    types.ts      shared types
    geo.ts        haversine + time estimates
    weather.ts    Open-Meteo client
    scoring.ts    rule-based fit score + reasons
    recommend.ts  end-to-end pipeline
    settings.ts   local key storage (data/config.json)
    db.ts         node:sqlite cache
    places/       taxonomy + google.ts + overpass.ts + orchestrator
```

Built for a personal trip, but designed as a generic discovery tool — usable in
any city, on any trip.
