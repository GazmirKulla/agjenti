-- A manual change to the agent's instructions and communication is saved once and is in use right away
-- (mode 'apply'); an earlier version is brought back the same way (mode 'revert'). Every saved change still
-- becomes a numbered version through record_agent_configuration, so history and rollback stay.
-- The draft modes stay for the drafts businesses already have: the owner applies one ('publish') or
-- drops it ('discard'); nothing activates a draft on its own. 'draft' and 'restore' stay accepted for
-- confirmations issued before this change.
--
-- Requires 20261104200251_agent_communication_configuration.sql.
-- Rollback: recreate save_agent_communication from 20261104200251_agent_communication_configuration.sql.
begin;
set local lock_timeout='5s';

create or replace function public.save_agent_communication(p_business uuid,p_user uuid,p_agent uuid,p_expected timestamptz,p_mode text,p_values jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.ai_agents; saved public.agent_configuration_versions; draft jsonb;
begin
 perform public.assert_business_operator(p_business,p_user);
 perform 1 from public.businesses where id=p_business for update;
 select * into a from public.ai_agents where id=p_agent and business_id=p_business for update;
 if not found then raise exception 'agent_not_found'; end if;
 if a.updated_at is distinct from p_expected then raise exception 'stale_agent'; end if;
 if p_mode in ('draft','apply') then
  if jsonb_typeof(p_values) is distinct from 'object' or (p_values-array['instructions','communication'])<>'{}'::jsonb
   or jsonb_typeof(p_values->'instructions') is distinct from 'string'
   or coalesce(length(btrim(p_values->>'instructions')),0) not between 1 and 8000
   or not public.valid_agent_communication(p_values->'communication') then raise exception 'invalid_agent_draft'; end if;
  if p_mode='apply' then
   -- An unchanged save keeps the revision (the trigger bumps it only on a real change).
   update public.ai_agents set instructions=p_values->>'instructions',communication=p_values->'communication',
    updated_at=greatest(clock_timestamp(),a.updated_at+interval '1 microsecond') where id=a.id returning * into a;
   return jsonb_build_object('revision',a.configuration_revision,'published',true,'active',a.is_active);
  end if;
  draft:=p_values || jsonb_build_object('baseRevision',a.configuration_revision);
 elsif p_mode in ('restore','revert') then
  select * into saved from public.agent_configuration_versions where agent_id=p_agent and business_id=p_business and revision=(p_values->>'revision')::bigint;
  if not found then raise exception 'configuration_not_found'; end if;
  if p_mode='revert' then
   update public.ai_agents set instructions=saved.instructions,communication=saved.communication,
    updated_at=greatest(clock_timestamp(),a.updated_at+interval '1 microsecond') where id=a.id returning * into a;
   return jsonb_build_object('revision',a.configuration_revision,'published',true,'active',a.is_active);
  end if;
  draft:=jsonb_build_object('instructions',saved.instructions,'communication',saved.communication,'baseRevision',a.configuration_revision);
 elsif p_mode='publish' then
  if a.configuration_draft is null then raise exception 'missing_agent_draft'; end if;
  if (a.configuration_draft->>'baseRevision')::bigint<>a.configuration_revision then raise exception 'stale_agent_draft'; end if;
  update public.ai_agents set instructions=configuration_draft->>'instructions',communication=configuration_draft->'communication',
   configuration_draft=null,updated_at=greatest(clock_timestamp(),a.updated_at+interval '1 microsecond') where id=a.id returning * into a;
  return jsonb_build_object('revision',a.configuration_revision,'published',true,'active',a.is_active);
 elsif p_mode='discard' then draft:=null;
 else raise exception 'invalid_configuration_mode'; end if;
 update public.ai_agents set configuration_draft=draft,updated_at=greatest(clock_timestamp(),a.updated_at+interval '1 microsecond') where id=a.id;
 return jsonb_build_object('revision',a.configuration_revision,'published',false,'active',a.is_active);
end $$;
revoke all on function public.save_agent_communication(uuid,uuid,uuid,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_agent_communication(uuid,uuid,uuid,timestamptz,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
