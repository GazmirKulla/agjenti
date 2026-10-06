alter table public.businesses
  add column if not exists dashboard_profile jsonb;

comment on column public.businesses.dashboard_profile is
  'Adaptive dashboard profile (modules, nav, widgets). Null = legacy product-centric UI.';
