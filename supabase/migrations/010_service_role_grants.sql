-- Service-role table grants for the tables the SERVER reads with the service
-- role.
--
-- Why: `requireAdmin()` (src/lib/supabase/auth.ts) reads `public.profiles` with
-- the service-role client to authorise admin routes. Tables created inside
-- migrations do NOT reliably inherit Supabase's default grants, so on a stack
-- built purely from these files the service role gets `42501 permission denied
-- for table profiles` — the query returns no row and EVERY admin request is
-- answered 403, making the admin console unreachable while looking like a
-- permissions problem on the user's side. Migration 004 hit the same thing with
-- `place_cache` and granted service_role explicitly; this is the same fix for
-- the auth/profile tables.
--
-- RLS still protects these tables from anon/authenticated callers; the service
-- role bypasses RLS by design and is only ever used server-side.

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.api_keys to service_role;
grant select, insert, update, delete on public.feedback to service_role;
grant select, insert, update, delete on public.profile_weights to service_role;
