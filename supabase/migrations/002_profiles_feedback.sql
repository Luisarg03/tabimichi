-- Tabimichi: user administration layer — profiles (roles), per-user feedback
-- and per-user taste weights, all with Row Level Security.
--
-- Depends on migration 001 (api_keys + update_updated_at()).
-- Run in Supabase SQL Editor after 001 (or via `supabase db push`).

-- ===========================================================================
-- 1. Profiles — one row per auth user; carries the role (user | admin)
-- ===========================================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- True when the current request is an admin (used by RLS policies).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Owners may read their own row; admins may read everything.
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

-- Direct writes are admin-only. Self-service display-name edits go through
-- public.update_display_name() (security definer) below, so a user can never
-- escalate their own role or edit their own email.
create policy "profiles_admin_insert"
  on public.profiles for insert
  with check (public.is_admin());

create policy "profiles_admin_update"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "profiles_admin_delete"
  on public.profiles for delete
  using (public.is_admin());

-- Self-service display name update. Security definer: the owner may only
-- touch their own row, and only the display_name column (role/email are
-- read-only for non-admins, enforced by comparing against the stored row).
create or replace function public.update_display_name(new_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare updated public.profiles;
begin
  update public.profiles
     set display_name = left(coalesce(new_name, ''), 40),
         updated_at = now()
   where id = auth.uid()
  returning * into updated;
  return updated;
end;
$$;

-- Keep profiles in sync with auth.users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set email = coalesce(new.email, ''),
         updated_at = now()
   where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of email on auth.users
  for each row execute function public.sync_user_email();

-- Backfill rows for users that already existed before this migration.
insert into public.profiles (id, email, display_name)
select id, coalesce(email, ''), coalesce(raw_user_meta_data ->> 'display_name', '')
from auth.users
on conflict (id) do nothing;

-- ===========================================================================
-- 2. Per-user feedback (👍 / 👎 votes on places)
-- ===========================================================================
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id text not null,
  liked boolean not null,
  tags jsonb,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

create policy "feedback_own"
  on public.feedback for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index feedback_user_id_idx on public.feedback(user_id);

-- ===========================================================================
-- 3. Per-user taste weights ("Tus gustos"), clamped to [-5, 5]
-- ===========================================================================
create table public.profile_weights (
  user_id uuid not null references auth.users(id) on delete cascade,
  tag text not null,
  weight integer not null default 0 check (weight between -5 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, tag)
);

alter table public.profile_weights enable row level security;

create policy "profile_weights_own"
  on public.profile_weights for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger profile_weights_updated_at
  before update on public.profile_weights
  for each row execute function update_updated_at();

-- ===========================================================================
-- 4. Grants (new tables are not auto-exposed in recent Supabase projects)
-- ===========================================================================
grant select, insert, update, delete on public.profiles to authenticated;
grant execute on function public.update_display_name(text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant select, insert, update, delete on public.feedback to authenticated;
grant select, insert, update, delete on public.profile_weights to authenticated;

-- Safety: make sure migration 001's table stays usable even when the project
-- does not auto-expose new tables.
grant select, insert, update, delete on public.api_keys to authenticated;
