-- Admin-controlled questionnaire steps for self-service onboarding.
alter table public.app_settings
  add column if not exists onboarding_steps text[] not null
  default array[
    'businessType',
    'useCases',
    'productCount',
    'productType',
    'aiMode',
    'messageVolume',
    'teamSize'
  ]::text[];

alter table public.app_settings
  drop constraint if exists app_settings_onboarding_steps_check;

alter table public.app_settings
  add constraint app_settings_onboarding_steps_check
  check (
    onboarding_steps <@ array[
      'businessType',
      'useCases',
      'productCount',
      'productType',
      'aiMode',
      'messageVolume',
      'teamSize'
    ]::text[]
  );
