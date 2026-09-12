-- Crowd observations ("¿cuánta gente hay acá ahora?").
--
-- The pedestrian-flow estimate is computed on the fly from data the discovery
-- request already carries (popularity, opening hours, weather, clock). What
-- cannot be computed is ground truth: one tap from the user standing in the
-- place. Those taps live here, per user, and are folded back into the estimate
-- for that same place — recent ones (≤3 h) move the value directly, older ones
-- (≤60 d) become a learned correction for that hour of the day.
--
-- Anonymous users write to the local SQLite store instead (lib/db.ts); rows
-- here are only for signed-in users, so RLS = own rows.

create table if not exists public.crowd_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id text not null,
  -- 0 = vacío, 1 = normal, 2 = lleno
  level smallint not null check (level between 0 and 2),
  -- destination-local hour/weekday captured at the moment of the report:
  -- server time is UTC, so the estimate cannot derive them later
  local_hour double precision not null check (local_hour >= 0 and local_hour < 24),
  weekend boolean not null default false,
  reported_at timestamptz not null default now()
);

alter table public.crowd_reports enable row level security;

create policy "crowd_reports_own"
  on public.crowd_reports for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- the only read pattern: "this place's reports, newest first"
create index if not exists crowd_reports_place_idx
  on public.crowd_reports (place_id, reported_at desc);

create index if not exists crowd_reports_user_idx
  on public.crowd_reports (user_id, reported_at desc);

grant select, insert, update, delete on public.crowd_reports to authenticated;
grant select, insert, update, delete on public.crowd_reports to service_role;
