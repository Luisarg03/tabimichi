-- Reconciled Google identity for OSM/Geoapify rows.
--
-- googleReconcile() already found the exact Google place_id for these rows,
-- but only rating/photos/url were persisted — the id itself was dropped, so
-- "Ver en Maps" fell back to OSM coordinates (meters off). Stored here, the
-- Maps links open the place directly via query_place_id/destination_place_id.
alter table if exists public.place_cache
  add column if not exists google_place_id text;
