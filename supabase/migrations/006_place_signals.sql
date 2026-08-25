-- Ranking context signals: persist the OSM wikipedia/wikidata tag so the
-- landmark boost survives cache reads (Overpass → cache → scoring).

alter table public.place_cache
  add column if not exists wikipedia text;
