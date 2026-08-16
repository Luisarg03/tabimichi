# Tabimichi 旅道 — Discover what to do today

[![Next.js](https://img.shields.io/badge/Next.js%2016-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React%2019-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS%20v4-38BDF8?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=for-the-badge&logo=leaflet&logoColor=white)](https://leafletjs.com)
[![SQLite](https://img.shields.io/badge/node%3Asqlite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://nodejs.org)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev)
[![Google Places](https://img.shields.io/badge/Google%20Places-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://developers.google.com/maps/documentation/places/web-service)
[![OpenStreetMap](https://img.shields.io/badge/Overpass-7EBC6F?style=for-the-badge&logo=openstreetmap&logoColor=white)](https://overpass-api.de)
[![Open-Meteo](https://img.shields.io/badge/Open--Meteo-FF6B35?style=for-the-badge)](https://open-meteo.com)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-4D6BFE?style=for-the-badge&logo=deepseek&logoColor=white)](https://deepseek.com)
[![DeepSeek Harness](https://img.shields.io/badge/Built%20with%20DeepSeek%20Harness-7C3AED?style=for-the-badge)](https://github.com/deepseek-ai/DeepSeek-Harness)

Tabimichi (旅道, "the road of the journey") is a local discovery app: tell it **where you are** and **how much time you
have**, and it recommends nearby places to explore — ranked by weather, distance,
time budget and your mood. It's a personal travel guide, not a hardcoded
itinerary: every recommendation is discovered live from real data sources.

> Status: **M3 done** — discovery + weather + scoring + map + LLM narrative +
> feedback profile, running locally. M4 (taste onboarding + season layer) and
> M5 (PWA/mobile) are next.

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
- **Interest keyword** — optional free-text ("pokemon", "book off", "gatos"):
  the Google text-search query becomes the keyword itself (no alias table —
  brands/English/Japanese pass raw, verified: "pokemon" → card & anime shops).
  Pure-Spanish words Google doesn't understand ("gatos" → ZERO_RESULTS) are
  translated with the free keyless MyMemory API (`lib/translate.ts`): one
  ~300 ms call per unique keyword, cached in memory afterwards (zero added
  latency on repeats; non-keyword requests never touch it). Japanese terms
  pass raw — Google indexes them directly. Matching places get +20 with a "Coincide con tu
  interés" reason (raw + translated terms both match names), chain/hotel
  penalties are waived for places the user explicitly asked for.
  `filters.nameMatches` in the log counts literal name hits — 0 literal hits
  can still be perfectly relevant (semantic matches, e.g. Animate for
  "pokemon").
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
- **Leaflet + react-leaflet** with switchable tile layers (OSM / CARTO
  Voyager / Positron / Esri Street — English labels in Japan / Esri
  satellite), all free, no key
- **node:sqlite** — zero-dependency local cache
- **i18n** ES / EN (built-in dictionaries)
- **DeepSeek Harness** — the agentic development environment this project was
  designed and built in, end to end

## License

**Proprietary.** The repository is public for viewing, but all rights are
reserved — the code may not be copied, modified, redistributed or used without
written permission. See [LICENSE](LICENSE).

## Testing

Three layers, all hermetic except the last one:

```bash
npm test          # unit + integration (Vitest, fetch fully mocked, temp stores)
npm test:watch    # TDD mode
npm run test:e2e  # smoke against a LIVE server (npm start first)
node scripts/analyze-recommend.mjs  # quality report per scenario (server on :3000)
```

- **Unit** (`src/lib/*.test.ts`): geo (modes/budgets), opening-hours (same-day,
  overnight, 24h), JST simulation, weather classification + hour override,
  scoring (travel bands, weather×mode, Bayesian rating, review volume, profile
  affinity, hard filters, interest-keyword boost + chain exemption), keywords
  (normalization, ES→EN aliases, name matching), LLM (retry on 5xx, fail-fast
  on 4xx, provider fallback, JSON parsing), place sources (Google/Geoapify/
  Overpass parsing + the full fallback chain google → geoapify → overpass →
  cache), DB (upsert, freshness, feedback clamping).
- **Integration** (`src/app/api/routes.test.ts`): every API route exercised
  with mocked fetch — recommend (incl. time-simulation filtering), feedback,
  settings, geocode, photo proxy (disk cache), photo dedupe.
- **E2E** (`scripts/smoke-e2e.mjs`): real server, real network — recommend
  (real + simulated hours), geocode, photo proxy, feedback, narrate.

Every request is **traced end-to-end** and persisted as JSON Lines in
`data/logs/requests.jsonl`. Each recommend generates a `traceId` that
correlates all its phases (recommend → narrate → photos), and every entry
carries the full picture for development evaluation:

- inputs (coords, budget, types, mode, simulation flag)
- discovery source + candidate count
- **filter breakdown** (how many candidates were dropped as closed / too far)
- scored results with scores, distances and reason keys
- weather used, the user's profile weights at that moment, latency
- narrate outcome (provider tier, narrative count, summary) and photo
  enrichment, linked by the same traceId

`GET /api/logs?tail=N` returns recent entries; `&trace=tr_…` filters one
request's full journey. API errors log with stack traces.

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
  app/            pages + API routes (/api/recommend, /narrate, /photos, /feedback, /settings, /geocode)
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
