-- Tabimichi: per-user guide model preference.
--
-- The virtual guide's model selection is a per-user preference stored in the
-- same table as the provider keys (api_keys already carries non-secret config
-- like the custom overpass_endpoint). The value is one of the model ids from
-- src/lib/llm/models.ts, or '' = auto (default free-first fallback chain).

-- 1. Widen the key_name allowlist to include 'guide_model'.
alter table public.api_keys
  drop constraint api_keys_key_name_check;

alter table public.api_keys
  add constraint api_keys_key_name_check check (
    key_name in (
      'google_places',
      'geoapify',
      'overpass_endpoint',
      'opencode_zen',
      'opencode_go',
      'guide_model'
    )
  );
