-- Shëndeti i Agjentit also follows the platform: background jobs (scans, imports, campaigns, scheduled
-- runs) and integrations (Instagram, WhatsApp, POK, Google). Their events are agent 'system'; a scheduled
-- run that serves all businesses has no business. Codes only, as before.
--
-- Additive. Rollback: delete from public.capability_events where agent = 'system';
--   alter table public.capability_events drop constraint capability_events_business_required;
--   alter table public.capability_events alter column business_id set not null;
--   alter table public.capability_events drop constraint capability_events_agent_check;
--   alter table public.capability_events add constraint capability_events_agent_check check (agent in ('customer','assistant'));
begin;
set local lock_timeout='5s';

alter table public.capability_events drop constraint if exists capability_events_agent_check;
alter table public.capability_events add constraint capability_events_agent_check check (agent in ('customer','assistant','system'));
alter table public.capability_events alter column business_id drop not null;
alter table public.capability_events drop constraint if exists capability_events_business_required;
alter table public.capability_events add constraint capability_events_business_required check (business_id is not null or agent = 'system');

notify pgrst, 'reload schema';
commit;
