-- Business settings for what the customer agent does by itself (Agjenti → Çfarë bën Agjenti):
--   voice: read the customer's voice messages and videos (transcribed); default true.
--   escalation: when the agent understands the customer is unhappy, complaining, or not being helped:
--     'handoff' (hand the conversation to staff, the default), 'notify' (keep answering and flag it for
--     staff) or 'off'.
-- Additive. Rollback: alter table public.businesses drop column agent_behavior;
begin;
set local lock_timeout='5s';
alter table public.businesses add column if not exists agent_behavior jsonb not null default '{}'::jsonb;
alter table public.businesses drop constraint if exists businesses_agent_behavior_check;
alter table public.businesses add constraint businesses_agent_behavior_check check (
  jsonb_typeof(agent_behavior) = 'object'
  and (not agent_behavior ? 'voice' or jsonb_typeof(agent_behavior->'voice') = 'boolean')
  and (not agent_behavior ? 'escalation' or agent_behavior->>'escalation' in ('handoff','notify','off'))
  and (agent_behavior - array['voice','escalation']) = '{}'::jsonb);
notify pgrst, 'reload schema';
commit;
