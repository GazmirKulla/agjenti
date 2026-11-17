-- Business preference for how much the agent says about a catalog product it presents:
-- productDetails 'helpful' (the supplied details that help the customer decide) or 'essentials'
-- (only what the customer asked). Optional key; policies without it keep the default in the app.
--
-- Requires 20261117150000_agent_product_photos.sql.
-- Rollback: recreate valid_agent_communication from 20261117150000_agent_product_photos.sql after
-- removing productDetails from ai_agents.communication, configuration_draft and agent_configuration_versions.
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
 and (p - array['version','language','tone','length','questions','emoji','productPhotos','productDetails'])='{}'::jsonb, false)
$$;

notify pgrst, 'reload schema';
commit;
