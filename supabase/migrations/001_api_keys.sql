-- Tabimichi: per-user API keys table with Row Level Security
-- Run this in Supabase SQL Editor after creating your project

-- 1. API Keys table — each user stores their own keys
create table api_keys (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  key_name text not null check (key_name in (
    'google_places',
    'geoapify',
    'overpass_endpoint',
    'opencode_zen',
    'opencode_go'
  )),
  key_value text not null default '',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(user_id, key_name)
);

-- 3. Enable Row Level Security
alter table api_keys enable row level security;

-- 4. Policies: users can ONLY see/modify their own keys
create policy "Users can read their own API keys"
  on api_keys for select
  using (auth.uid() = user_id);

create policy "Users can insert their own API keys"
  on api_keys for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own API keys"
  on api_keys for update
  using (auth.uid() = user_id);

create policy "Users can delete their own API keys"
  on api_keys for delete
  using (auth.uid() = user_id);

-- 5. Auto-update updated_at timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger api_keys_updated_at
  before update on api_keys
  for each row
  execute function update_updated_at();

-- 6. Index for fast lookups
create index api_keys_user_id_idx on api_keys(user_id);
