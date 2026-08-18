<div align="center">

# 🗾 Tabimichi 旅道

### *Discover what to do today*

A local discovery app that recommends nearby places ranked by **weather**, **distance**, **time budget** and your **mood**.

<br/>

[![Next.js](https://img.shields.io/badge/Next.js_16-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React_19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_v4-38BDF8?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=flat-square&logo=leaflet&logoColor=white)](https://leafletjs.com)
[![SQLite](https://img.shields.io/badge/node%3Asqlite-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://nodejs.org)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev)
[![Google Places](https://img.shields.io/badge/Google_Places-4285F4?style=flat-square&logo=google&logoColor=white)](https://developers.google.com/maps/documentation/places/web-service)
[![Overpass](https://img.shields.io/badge/Overpass-7EBC6F?style=flat-square&logo=openstreetmap&logoColor=white)](https://overpass-api.de)
[![Open-Meteo](https://img.shields.io/badge/Open--Meteo-FF6B35?style=flat-square)](https://open-meteo.com)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://deepseek.com)
[![DeepSeek Harness](https://img.shields.io/badge/Built_with_DeepSeek_Harness-7C3AED?style=flat-square)](https://github.com/deepseek-ai/DeepSeek-Harness)

<br/>

<img src="docs/screenshots/03-results.png" alt="Tabimichi recommendation results" width="700">

</div>

---

## 🚀 Quick start

**Requirement:** Node.js ≥ 22.5 (built-in `node:sqlite`)

```bash
pnpm install
pnpm run dev     # → http://localhost:3000
```

No keys needed to try it — discovery falls back to free sources (Overpass + local cache). Add optional keys in `.env` (see [`.env.example`](.env.example)) for richer results.

---

## 🔑 API keys (optional)

| Service | Purpose | Cost |
|---------|---------|------|
| Google Places | Ratings, hours, photos | Free $200/mo credit |
| Geoapify | Backup discovery source | Free 3k req/day |
| Overpass | `OVERPASS_ENDPOINT` (own osm3s Docker) | Free / self-hosted |
| OpenCode Zen / Go | LLM guide | Free / pay-per-use |

Users can also set their own keys in the app (**⚙️ Ajustes** → API keys) — stored per-user in Supabase with RLS.

> **Security rule:** only `NEXT_PUBLIC_*` vars reach the browser. Keep every real secret (`GOOGLE_PLACES_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, …) server-side. The only public vars are the Supabase URL + anon key (RLS protects the data).

---

## 🚀 Deploy to Vercel

```bash
bash scripts/setup-vercel.sh    # guided: login + env vars
```

Or manually: `vercel link` → add env vars → `vercel --prod`. Preview deploys are created automatically for every PR.

---

## 🗄️ Supabase (accounts & per-user keys)

1. **Create a free project** at [supabase.com](https://supabase.com)
2. **Run migrations** from `supabase/migrations/` in order (or `supabase db push --project-ref <ref>`)
3. **Add env vars** to Vercel:

| Variable | Where to find it |
|----------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Same as above |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role (secret) |

4. **Done** — users sign up, manage their own keys, and their feedback/profile is stored per-user (RLS); anonymous users fall back to local SQLite.

**Admin console** (`/admin`, for `role = 'admin'` users): list users, promote/demote admin, suspend, delete. Promote yourself with:

```sql
update public.profiles set role = 'admin' where email = 'tu@email.com';
```

> **⚠️ Two environments exist:** sandbox (`rjsrzuqyoyxuonvcrpec`, used by local CLI + Preview) and production (`yfwslmehyaftomzmkafs`). Never link the CLI to production — always pass `--project-ref` explicitly when pushing migrations. Local dev uses Supabase Local (`supabase start`).

---

## ⚙️ How it works

```
📍 location + ⏱️ time + 🚃 transport + 🎭 mood
                    │
                    ▼
      /api/recommend  (~1s)
      weather (parallel) + discovery (4 sources)
                    │
                    ▼
         Rule scoring (0–100)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  🃏 Cards + 🗺️ map        🧠 LLM narrative
  (instant)               (async, fills in later)
```

- **Scoring (0–100):** travel time, weather fit, Bayesian rating, open now, keyword match, and your learned feedback profile.
- **Transport modes:** walking / transit / car change the search radius and travel times.
- **Discovery:** Google Places → Geoapify → Overpass → SQLite cache, with automatic fallback.
- **Caches:** weather 10 min, discovery 15 min, Overpass 30 s hard budget.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 **Multi-source discovery** | Google → Geoapify → Overpass → cache, auto-fallback |
| 🌤️ **Weather-aware scoring** | Open-Meteo forecast drives indoor/outdoor picks |
| 🚃 **Transport modes** | Walking / transit / car affect radius and travel time |
| 🧠 **LLM narrative** | Two-tier provider writes day summaries and per-place "why" |
| 📸 **Photo gallery** | Up to 8 photos per place, async enrichment |
| 👍 **Feedback loop** | 👍/👎 per card → learned profile → weighted scoring |
| ⚙️ **Tus gustos** | Manual profile weights (−5..+5 per experience type) |
| ⏰ **Time simulation** | Discover at any hour (JST-aware) |
| 🌐 **i18n** | Spanish / English |
| 📱 **Responsive** | Desktop and mobile |

---

## 🧪 Testing

```bash
pnpm test          # Unit + integration (Vitest)
pnpm test:watch    # TDD mode
pnpm run test:e2e  # E2E smoke tests (needs live server)
pnpm run test:e2e:browser  # Browser E2E: register → confirm → login → save keys → discover
```

> The browser E2E (`scripts/test-e2e.mjs`, Playwright) needs `playwright` available to Node (it's imported from `scripts/node_modules` when installed there: `npm install --no-save --no-package-lock --prefix scripts playwright`) and a live stack: `next dev` + Supabase Local + inbucket (`supabase start`). It registers a throwaway user (`test-<ts>@tabimichi.test`), handles email confirmation via inbucket when confirmations are on, saves per-user API keys and verifies they persist.

> Two smoke checks are skipped (with a `⚠` note) when `GOOGLE_PLACES_API_KEY` is absent: simulated opening-hours evaluation and interest-keyword discovery — both depend on Google Text Search data. Everything else runs against the free fallback stack (Overpass + local SQLite cache).

Tests run in temp dirs (`TABI_DATA_DIR` / `setDataDir()` / …) and never touch real data or keys. Every request is traced via `traceId` (JSON Lines in `data/logs/requests.jsonl`).

---

## 📁 Project layout

```
src/
├── app/
│   ├── api/          # recommend, narrate, photos, feedback, profile,
│   │                 # user-keys, me, account, admin, geocode, logs
│   ├── page.tsx      # Main UI (map + cards)
│   ├── settings/     # Account + API key management
│   └── admin/        # Admin console
├── components/       # Map, cards, auth, settings, weather…
└── lib/              # Pipeline, scoring, weather, places, llm, supabase…
```

---

## 🗺️ Roadmap

**M1 ✅ Foundation** · **M2 ✅ Transport + LLM narrative** · **M3 ✅ Feedback + profile learning** · **M4 🔜 Onboarding + seasonal layers** · **M5 📋 Mobile + PWA**

---

## 📄 License

**Proprietary.** Public for viewing, but all rights reserved — the code may not be copied, modified, redistributed or used without written permission. See [LICENSE](LICENSE).

---

<div align="center">

*Built for a personal trip, but designed as a generic discovery tool — usable in any city, on any trip.*

🇯🇵 旅道 — *The road of the journey*

</div>
