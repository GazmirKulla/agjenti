-- Onboarding has two modes: step-by-step manual questions (no audio) or a
-- minimal workspace where the dashboard agent asks the remaining questions.
alter table public.app_settings drop constraint if exists app_settings_onboarding_mode_check;
update public.app_settings set onboarding_mode = 'manual' where onboarding_mode = 'guided';
alter table public.app_settings alter column onboarding_mode set default 'manual';
alter table public.app_settings
  add constraint app_settings_onboarding_mode_check check (onboarding_mode in ('manual', 'agent'));
