alter table public.app_settings
  add column if not exists onboarding_mode text not null default 'guided'
  check (onboarding_mode in ('guided', 'agent'));
