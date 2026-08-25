-- Place search (autocomplete) over the cached pool.
-- pg_trgm gives us a GIN index that accelerates ILIKE '%query%' patterns used
-- by /api/search/suggest (and any future fuzzy name match).

create extension if not exists pg_trgm;

create index if not exists place_cache_name_trgm_idx
  on public.place_cache using gin (name gin_trgm_ops);
