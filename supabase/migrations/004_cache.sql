-- Server-side cache, so it survives Vercel serverless cold starts.
-- Places in Postgres, photo bytes in the private `photos` Storage bucket.
-- Accessed ONLY with the service role from API routes; RLS denies everyone else.

create table if not exists public.place_cache (
  id text primary key,
  source text not null,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  tags text not null,
  rating double precision,
  user_ratings_total integer,
  price_level integer,
  open_now integer,
  address text,
  photo_ref text,
  photo_refs text,
  url text,
  photos_verified boolean not null default false,
  fetched_at timestamptz not null default now()
);

create index if not exists place_cache_ll_idx on public.place_cache (lat, lng);

alter table public.place_cache enable row level security;

-- service role bypasses RLS but still needs table grants.
grant select, insert, update, delete on public.place_cache to service_role;

-- Photo bytes cache (private bucket; served through /api/photo with the
-- requesting user's own Google key). 10 MB cap per object.
insert into storage.buckets (id, name, public, file_size_limit)
values ('photos', 'photos', false, 10 * 1024 * 1024)
on conflict (id) do nothing;
