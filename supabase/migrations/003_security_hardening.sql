-- Security hardening: lock down function grants.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default. These are
-- internal/trigger helper functions — nobody should be able to call them
-- directly through the Data API. (Trigger execution uses the owner's
-- privileges, so revoking from PUBLIC does not affect trigger behavior.)
-- Run after migrations 001 and 002 (or via `supabase db push`).

revoke execute on function public.update_updated_at() from public;

revoke execute on function public.handle_new_user() from public;

revoke execute on function public.sync_user_email() from public;
