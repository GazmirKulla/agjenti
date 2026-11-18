-- Business setting: what the agent tells the customer when the conversation is handed to staff
-- (communication.handoffMessage, optional text up to 300 characters). It is the owner's wording; the
-- handoff itself is still decided by the process and requires the inbox module.
--
-- Requires 20261117170000_agent_product_details.sql.
-- Rollback: recreate valid_agent_communication from 20261117170000_agent_product_details.sql after
-- removing handoffMessage from ai_agents.communication, configuration_draft and agent_configuration_versions.
begin;
set local lock_timeout='5s';

create or replace function public.valid_agent_communication(p jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(p)='object'
 and p->'version'='1'::jsonb
 and p->>'language' in ('customer','sq','en') and p->>'tone' in ('warm','neutral','formal')
 and p->>'length' in ('concise','balanced') and p->>'questions' in ('when_needed','on_request')
 and p->>'emoji' in ('none','light')
 and (not p ? 'productPhotos' or p->>'productPhotos' in ('send','off'))
 and (not p ? 'productDetails' or p->>'productDetails' in ('helpful','essentials'))
 and (not p ? 'handoffMessage' or (jsonb_typeof(p->'handoffMessage')='string'
   and length(btrim(p->>'handoffMessage')) between 1 and 300 and p->>'handoffMessage'=btrim(p->>'handoffMessage')))
 and (p - array['version','language','tone','length','questions','emoji','productPhotos','productDetails','handoffMessage'])='{}'::jsonb, false)
$$;

notify pgrst, 'reload schema';
commit;
