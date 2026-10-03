-- Singleton app configuration. Only server-authorized platform admins may write.
create table public.app_settings (
  id boolean primary key default true check (id = true),
  onboarding_enabled boolean not null default true,
  checklist_enabled boolean not null default true,
  announcement text not null default '' check (char_length(announcement) <= 500),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant all on public.app_settings to service_role;
insert into public.app_settings(id) values (true);
