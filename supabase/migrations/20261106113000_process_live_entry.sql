-- Accept only the exact empty legacy initializer; existing progress is never reset.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function public.commit_process_checkpoint(
 p_business uuid,p_conversation uuid,p_job bigint,p_token uuid,
 p_event text,p_event_hash text,p_revision integer,p_state jsonb,
 p_reply text default null,p_targets jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.workflow_inbound_queue; c public.conversations; s public.conversation_states;
 prior public.process_event_receipts; target jsonb; matched boolean; enabled boolean;
begin
 select * into j from public.workflow_inbound_queue where id=p_job and business_id=p_business and lease_token=p_token for update;
 if not found or j.leased_until<=clock_timestamp() or j.leased_until is null or j.status not in ('processing','prepared') then raise exception 'lease_lost'; end if;
 select * into c from public.conversations where id=p_conversation and business_id=p_business
  and public.workflow_conversation_matches(conversations,j) for update;
 if not found then raise exception 'invalid_conversation'; end if;
 select coalesce(c.auto_reply,b.auto_reply,false) into enabled from public.businesses b where id=p_business;
 if c.status<>'active' or not enabled then raise exception 'ownership_lost'; end if;
 select * into s from public.conversation_states where conversation_id=p_conversation and business_id=p_business for update;
 if not found then raise exception 'missing_state'; end if;
 select * into prior from public.process_event_receipts where business_id=p_business and conversation_id=p_conversation and event_id=p_event;
 if found then
  if prior.event_hash is distinct from p_event_hash or prior.job_id<>p_job then raise exception 'event_conflict'; end if;
  return jsonb_build_object('replayed',true,'revision',s.revision,'state',s.collected);
 end if;
 if j.status<>'processing' then raise exception 'reply_already_prepared'; end if;
 if s.revision is distinct from p_revision then raise exception 'stale_state'; end if;
 -- Starting a new schema requires an explicit empty/reset state. Never silently reinterpret legacy progress.
 if s.collected<>'{}'::jsonb and s.collected <> '{"product_id":null,"product_type_id":null,"step_key":"choose_product","fields":{},"customer":{"name":null,"phone":null,"city":null,"address":null}}'::jsonb and s.collected->>'schemaVersion' is distinct from '4' then raise exception 'state_reset_required'; end if;
 if jsonb_typeof(p_state) is distinct from 'object' or p_state->>'schemaVersion' is distinct from '4' or p_state->>'mode' is distinct from 'live'
  or p_state->>'businessId' is distinct from p_business::text or p_state->>'conversationId' is distinct from p_conversation::text
  or (p_state->>'revision')::integer is distinct from p_revision+1
  or jsonb_typeof(p_state->'instances') is distinct from 'object' or jsonb_typeof(p_state->'offers') is distinct from 'object'
  or octet_length(p_state::text)>1048576 then raise exception 'invalid_process_state'; end if;
 if jsonb_typeof(p_targets) is distinct from 'array' or jsonb_array_length(p_targets)>32
  or (p_reply is null and p_targets<>'[]'::jsonb) or (p_reply is not null and length(btrim(p_reply)) not between 1 and 20000) then raise exception 'invalid_process_reply'; end if;
 for target in select value from jsonb_array_elements(p_targets) loop
  if jsonb_typeof(target)<>'string' then raise exception 'invalid_prompt_target'; end if;
  select exists(select 1 from jsonb_each(p_state->'offers') o where o.key=target#>>'{}')
   or exists(select 1 from jsonb_each(p_state->'instances') i where i.value->'wait'->>'id'=target#>>'{}' and i.value->'wait'->>'kind' in ('field','approval')) into matched;
  if not matched then raise exception 'invalid_prompt_target'; end if;
 end loop;
 insert into public.process_event_receipts(business_id,conversation_id,event_id,event_hash,job_id,revision)
  values(p_business,p_conversation,p_event,p_event_hash,p_job,p_revision+1);
 update public.conversation_states set collected=p_state,revision=p_revision+1,workflow_id=null,step_key=null,status='in_progress',updated_at=now()
  where conversation_id=p_conversation and business_id=p_business;
 if p_reply is not null then
  update public.workflow_inbound_queue set status='prepared',conversation_id=p_conversation,reply=p_reply,process_prompt_targets=p_targets,process_presented_at=null where id=p_job;
 end if;
 return jsonb_build_object('replayed',false,'revision',p_revision+1,'state',p_state);
end $$;

create or replace function public.record_delivered_process_reply() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform public.record_process_presentation(new.business_id,new.id,new.lease_token);
 if exists(select 1 from public.conversation_states where business_id=new.business_id and conversation_id=new.conversation_id
   and collected->>'schemaVersion'='4' and collected->>'handoffRequested'='true') then
  update public.conversations set status='paused',auto_reply=false where id=new.conversation_id and business_id=new.business_id;
 end if;
 return null;
end $$;

commit;
