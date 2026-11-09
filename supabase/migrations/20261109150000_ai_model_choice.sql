-- The AI model is chosen by platform administrators: one default for the
-- platform and an optional override per business. Empty means "use the
-- default" (platform setting, then the AGENT_MODEL environment variable).
alter table public.app_settings
  add column if not exists ai_model text check (ai_model is null or ai_model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$');
alter table public.businesses
  add column if not exists ai_model text check (ai_model is null or ai_model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$');
