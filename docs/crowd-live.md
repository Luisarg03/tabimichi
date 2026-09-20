# Live pedestrian data — what exists, what it costs, what we chose

Research for the "gente ahora" feature (`openspec/changes/crowd-now/`). The
question was blunt: *I'm in Osaka at 8:00, going to Nara — can the app show me
how many people are at each place right now?* without paying a third party.

Short answer: **a free, global, real-time pedestrian count does not exist.** The
feature is therefore an estimate computed at request time from data the app
already has, corrected by the user's own one-tap observations, and it says so.

## Sources evaluated

| Source | Live? | Cost | Coverage | Verdict |
|---|---|---|---|---|
| Google Popular Times (+ live busyness) | yes | — | global | **Rejected**: no public API. It is not in Places API responses, and scraping the web UI violates the Maps ToS. |
| BestTime, Placer.ai, Advan, Safegraph, Dewey | yes | paid | global-ish | **Rejected**: paid third parties. |
| Municipal open counters (Melbourne, Dublin, …) | hourly | free | that city only | Not usable for Japan; kept as a future adapter. Melbourne publishes a free pedestrian-counting API, Dublin publishes footfall CSVs. |
| Japan open pedestrian counters | — | — | none found | Japanese municipalities publish 歩行者通行量調査 as periodic surveys, not live feeds. |
| Mobile-network people-flow (KDDI/DoCoMo via MLIT/RESAS) | monthly-ish | free-ish, licensed | Japan | **Not live**, licensing restricts redistribution; possible offline calibration knob. |
| CCTV + computer vision (self-hosted, YOLO/ONNX) | yes | hardware | only where a camera is | **Rejected for v1**: see below. |
| GTFS-RT from ODPT / JR East | yes | free (registration) | transit, not pedestrians | Useful as a disruption signal later; does not measure footfall. |
| Weather + clock + hours + popularity (what we built) | recomputed per search | free | global | **Chosen**. |

### Measured evidence

- **Overpass density** (real query, 1 km around Shibuya 35.6595/139.7005, 10.4 s):
  673 `shop`, 1 676 `amenity`, 6 `railway=station`, 105 `highway=bus_stop`,
  135 `office`, 113 `tourism`, 5 921 `building` nodes. Enough density to model
  footfall — but this models *infrastructure*, not *people on the day*, which is
  why the shipped feature uses it only as a fallback prior and leans on real
  review volume instead.
- **Public cameras in Japan**: [opendata-livecamera-jp](https://github.com/w16y/opendata-livecamera-jp)
  (CC0 metadata) lists 829 cameras with coordinates — 155 road, 108 river, 91
  coast, **86 tourism**, 44 other, 44 mountain, 37 airport, 28 railway; 361 are
  video streams (mostly YouTube), 233 are still images. It includes the Shibuya
  Scramble Crossing live stream. It has **no camera in Nara**, and the stream
  content itself belongs to its publisher, whose terms do not allow automated
  frame extraction.
- **Reference project**: [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view)
  (MIT) projects ~800 public cameras from city APIs (Austin, Caltrans, TfL) into
  a 3D globe. It does **not** count people — its own README states people are not
  a query type in that project. The CCTV layer there is a viewer, not a sensor.

## Why CCTV / person counting is not in v1

1. **No source to scale.** Japan has no open camera registry; the CC0 catalogue
   is mostly rivers, roads and airports. One camera answers for one spot, and
   the spots a traveller cares about are not the ones with cameras.
2. **Terms.** Most streams are YouTube-hosted; extracting frames programmatically
   is against their terms. Municipal image cameras are cleaner but are roads.
3. **Infrastructure.** Detection needs a persistent worker (no GPU on Vercel).
   That is a server to run and babysit, for a handful of points.
4. **Privacy.** Counting people in public space is a different risk class from
   ranking places. If it is ever built, the design is: on-device inference,
   counts only, no frames stored, no identities, no faces, no re-identification.

**What would change the verdict**: a national open camera registry with reuse
terms that permit analysis, or a city publishing pedestrian counts as open data
where the user actually travels. If that appears, the integration point is a
single "observed" adapter that writes into the same `crowd_reports` store the
user's own taps use — the estimate already knows how to blend observations.

## What the shipped model uses

`level = popularity × hourCurve(category, localHour) × dayFactor(weekend|holiday)
× weatherFactor × seasonFactor`, then the user's own observations.

- **popularity** — `log10(1 + user_ratings_total)`, i.e. real visit volume;
  per-category pseudo-count when a source has no reviews; Wikipedia/Wikidata
  boost; normalized against the pool's p95 so the scale is "busier than what".
- **hourCurve** — per experience type (temple, museum, food, market, shopping,
  park, sakura, viewpoint, trekking, onsen, nightlife), nightlife wrapping past
  midnight.
- **dayFactor** — weekends and Japanese public holidays lift day-trip places
  (markets 1.4×, temples 1.35×) more than restaurants (1.15×).
- **weatherFactor** — rain/snow and temperature extremes move people indoors
  rather than only removing them.
- **seasonFactor** — the sakura window (25 Mar – 10 Apr) lifts blossom spots and
  parks.
- **observations** — recent taps (≤3 h) override with decay; two agreeing taps
  win; older taps (≤60 d) become a capped per-place correction for that hour
  bucket and weekday class.

### Calibration knobs (not implemented)

- **駅別乗降客数 (MLIT 国土数値情報 S12)** — free nationwide station ridership,
  would replace the uniform station prior with real boarding numbers. This is
  the single highest-value calibration for Japan.
- **Daytime population mesh (e-Stat / 国勢調査 500 m mesh)** — free, registered
  API; a real "how many people are in this cell during the day" prior.
- **Open municipal counters** — real observations for the cities that publish
  them, plugged in as an "observed" source.

## Honesty rules the UI follows

- Every value is labelled `estimado`, `observado hace X min`, or `estimado + tu
  reporte`; the detail adds "no es una medición".
- Nothing in the ranking is silently reordered by crowd level in v1.
- The model never invents an absolute number of people — only a relative level
  against the places you are choosing between.

## Hot zones (Fase 1 — named clusters over the heat field)

`src/lib/crowd/zones.ts` groups hot cells (`weight ≥ 0.55`) by single-linkage
(≤300 m between members) into at most 5 zones: weight-averaged centroid,
p95 radius clamped to 150–600 m, member places (≤8, busiest first). A lone
cell only counts when `weight ≥ 0.8`. Zones ride on `RecommendResult.hotZones`,
are logged as summaries (`lat/lng/weight/label/places`, no user data), and
render as tappable Leaflet circles + legend chips in `MapView` — same
opt-in toggle, same honesty labels. No new API route, no new table.
