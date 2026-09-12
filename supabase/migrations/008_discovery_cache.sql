-- Discovery cache: keyword provenance + empty-area markers.
--
-- Why: only 29% of recommend requests hit the cache although 71% repeat a
-- query signature seen before. Two gaps caused it, both measured from
-- data/logs/requests.jsonl (356 recommends):
--   1. keyword searches skipped the cache entirely (83 requests, 94% went
--      live, p50 4.9s) because `fromKeyword` — the flag that drives keyword
--      ranking in recommend.ts — was never persisted;
--   2. a conclusive "nothing here" was never remembered, so a failing area
--      re-spent Overpass' full 20s budget on every retry (24 requests,
--      p50 20s, max 84s).
--
-- `fromKeyword` is written by the Google text-search path only, so the two
-- new columns stay NULL/false for Overpass and Geoapify rows.

alter table public.place_cache
  add column if not exists from_keyword boolean not null default false;

-- Normalized keyword this row was discovered for ("pokemon", "cafe neko").
-- NULL for generic discovery rows. Kept as text so a keyword pool can be
-- looked up without a bounding box (the query point itself is the key).
alter table public.place_cache
  add column if not exists keyword_key text;

-- Partial index: keyword lookups are the only ones that filter on this
-- column, so the index stays small (keyword rows are a minority of the pool).
create index if not exists place_cache_keyword_idx
  on public.place_cache (keyword_key, fetched_at desc)
  where keyword_key is not null;
