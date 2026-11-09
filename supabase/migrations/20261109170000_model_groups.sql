-- Model groups replace the single model setting. Each group names a model for
-- three kinds of work: replies to customers, the owner's assistant, and small
-- internal checks. The platform uses one group; a business may use another.
-- An empty model falls back to the AGENT_MODEL environment default.
create table if not exists public.model_tiers (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  label text not null check (length(btrim(label)) between 1 and 40),
  position integer not null default 0,
  customer_model text check (customer_model is null or customer_model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$'),
  assistant_model text check (assistant_model is null or assistant_model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$'),
  utility_model text check (utility_model is null or utility_model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$'),
  updated_at timestamptz not null default now()
);
alter table public.model_tiers enable row level security;
revoke all on public.model_tiers from anon, authenticated;
grant all on public.model_tiers to service_role;

insert into public.model_tiers(id, label, position) values
  ('normal', 'Normal', 1), ('high', 'High', 2), ('very_high', 'Very high', 3)
on conflict (id) do nothing;

alter table public.app_settings
  add column if not exists model_tier text not null default 'high' references public.model_tiers(id);
alter table public.businesses
  add column if not exists model_tier text references public.model_tiers(id) on delete set null;

-- The single-model columns from earlier today were never used.
alter table public.app_settings drop column if exists ai_model;
alter table public.businesses drop column if exists ai_model;
