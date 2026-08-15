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
Where are you? + time budget + transport mode + mood/type
        ↓
  /api/recommend  (fast path ~1s: weather ∥ discovery, rule scoring)
        ↓
  Cards + map instantly       ←──  then, async:
        ↓                           /api/narrate (LLM, ~5-10s)
  "El guía está escribiendo…"       day summary + per-place "why"
        ↓
  Summary + narratives fill in
```

**Latency design (two phases):** the rules pipeline (weather + discovery +
scoring) responds in ~1s and renders the cards; the LLM narrative runs as a
separate async call and fills in the day summary + per-place "why" when ready.
Repeated queries hit the freshness caches:

- **Weather cache** (in-memory, 10 min TTL per ~1 km area)
- **Discovery cache** (SQLite, 15 min TTL, only when every requested type is covered)
- **Overpass hard budget** (30 s ceiling so the fallback can never hang a request)

- **Transport mode** — 🚶 walking / 🚃 train-bus / 🚗 car changes everything:
  the discovery radius (walking ~0.4×, car ~2×), travel-time heuristics
  (4.5 km/h on foot, ~28 km/h + wait for transit, ~40 km/h by car) and the
  reasons ("a 15 min en tren", "a 6 min en auto"). Walking under rain/snow
  penalizes outdoor picks extra.
- **Discovery** — multi-source, tried in priority order:
  1. **Google Places** (text + nearby search, strictbounds) when a key is configured
  2. **Geoapify** (free tier, 3k req/day) when a key is configured
  3. **OpenStreetMap Overpass** — your own osm3s endpoint if set, else public mirrors
  4. **local SQLite cache** (`data/tabi.db`) as last resort
  Results are always cached for resilience.
- **Scoring** — rule-based "base fit" score (0–100): travel time vs. budget,
  weather fit, **Bayesian-shrunk rating** (a 4.5★ with 5 reviews ≈ 4.0),
  **review volume** (capped popularity boost), open-now status, hard distance
  cap, profile affinity (M3).
- **LLM narrative (M2)** — `lib/llm/` two-layer provider registry, tried in
  order: **OpenCode Zen (free)** `deepseek-v4-flash-free` at
  `opencode.ai/zen/v1` → **OpenCode Go (paid)** `deepseek-v4-flash` at
  `opencode.ai/zen/go/v1`. Fail-fast on rate limits (429), retry on transient
  5xx, fall back to the next layer. The model writes a "why go today" for the
  top picks in the app's language; the rules still score, the LLM only
  narrates. Cards show which layer narrated. No provider → rule reasons only.
- **Photos & popularity** — cards show a photo gallery (up to 8 per place via
  Place Details, async enrichment after the fast response). Photos are served
  through a local proxy with per-photo on-disk cache (`data/photos/`, key
  never exposed). Cards show rating + review count as a popularity panorama.
- **Closed-now filter** — places known to be closed at query time are excluded
  (nearby search uses `opennow`), so recommendations are always reachable.
- **Storage** — `node:sqlite` (built into Node ≥ 22.5, no native deps):
  place cache + user profile & feedback.

## Settings / API keys

Open **⚙️ Ajustes** in the app or edit `data/config.json` directly (gitignored).
Keys never leave your machine; environment variables override the file.

| Key | Env var | Purpose |
|-----|---------|---------|
| Google Places | `GOOGLE_PLACES_API_KEY` | Primary source: ratings, hours, photos. $200/month free credit (~6k calls) — effectively free for personal use. |
| Geoapify | `GEOAPIFY_API_KEY` | Free backup source (3,000 req/day, no credit card). |
| Overpass endpoint | `OVERPASS_ENDPOINT` | Point to your own osm3s (Docker) for unlimited reliable OSM data; empty = public mirrors. |
| OpenCode Zen | `OPENCODE_API_KEY` | LLM guide — next phase (M2). |
| OpenCode Go | `OPENCODE_GO_API_KEY` | LLM guide — next phase (M2). |

Without any key the app still works via public Overpass + local cache; public
instances are shared and can be slow or overloaded — the app degrades
gracefully with a clear "data unavailable" message.

## Tech stack

- **Next.js 16** (App Router) + TypeScript + Tailwind CSS v4
- **Leaflet + react-leaflet** with OpenStreetMap tiles (free, no key)
- **node:sqlite** — zero-dependency local cache
- **i18n** ES / EN (built-in dictionaries)

## Testing

Three layers, all hermetic except the last one:

```bash
npm test          # unit + integration (Vitest, fetch fully mocked, temp stores)
npm test:watch    # TDD mode
npm run test:e2e  # smoke against a LIVE server (npm start first)
```

- **Unit** (`src/lib/*.test.ts`): geo (modes/budgets), opening-hours (same-day,
  overnight, 24h), JST simulation, weather classification + hour override,
  scoring (travel bands, weather×mode, Bayesian rating, review volume, profile
  affinity, hard filters), LLM (retry on 5xx, fail-fast on 4xx, provider
  fallback, JSON parsing), place sources (Google/Geoapify/Overpass parsing +
  the full fallback chain google → geoapify → overpass → cache), DB (upsert,
  freshness, feedback clamping).
- **Integration** (`src/app/api/routes.test.ts`): every API route exercised
  with mocked fetch — recommend (incl. time-simulation filtering), feedback,
  settings, geocode, photo proxy (disk cache), photo dedupe.
- **E2E** (`scripts/smoke-e2e.mjs`): real server, real network — recommend
  (real + simulated hours), geocode, photo proxy, feedback, narrate.

Every recommend/narrate call is **persisted** as JSON Lines in
`data/logs/requests.jsonl` (coords, budget, mode, simulation flag, source,
candidates/scored counts, empty reason, latency, top results) and API errors
are logged with stack traces. The console line `[tabi] recommend` mirrors the
short form, and `GET /api/logs?tail=N` returns the recent entries.

The **guide is on-demand**: after a discovery the cards show immediately and
a button ("Preguntale al guía") triggers the LLM summary + per-place "why";
it can be regenerated anytime. No automatic LLM cost per search.

Empty results are classified so the UI explains *why*: `all_closed` (e.g.
searching at 3 AM in Japan), `too_far` (beyond your time/transport) or
`no_results` (sources returned nothing).

Testability hooks: `TABI_DATA_DIR` env / `setDataDir()` / `setConfigPath()` /
`setPhotoDir()` / `clearWeatherCache()` — tests run in temp dirs and never
touch your real data or API keys.

## Roadmap

| Milestone | Scope |
|-----------|-------|
| **M1 ✅** | Discovery (Google/Geoapify/Overpass), weather, scoring, map, i18n, settings |
| **M2 ✅** | Transport mode factor (walking/transit/car) + `lib/llm/` narrative "why now" (retry + provider fallback) |
| **M3 ✅** | Feedback loop: 👍/👎 per card → tag profile → weighted scoring + reactive map selection |
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
    geo.ts        haversine + travel time by transport mode
    weather.ts    Open-Meteo client
    scoring.ts    rule-based fit score + reasons (mode-aware)
    recommend.ts  end-to-end pipeline (rules score → LLM narrates)
    llm/          provider registry + OpenAI-compatible client + narrate()
    settings.ts   local key storage (data/config.json)
    db.ts         node:sqlite cache
    places/       taxonomy + google/geoapify/overpass adapters + orchestrator
```

Built for a personal trip, but designed as a generic discovery tool — usable in
any city, on any trip.
