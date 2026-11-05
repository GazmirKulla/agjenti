-- Construction of the replacement runtime. No historical records are reset here.
-- conversation_states remains authoritative; workflow_inbound_queue remains the outbox.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.conversations add constraint conversations_business_id_id_key unique (business_id,id);
create table public.process_event_receipts (
 business_id uuid not null,
 conversation_id uuid not null,
 event_id text not null check(length(event_id) between 1 and 250),
 event_hash text not null check(event_hash ~ '^[0-9a-f]{64}$'),
 job_id bigint not null references public.workflow_inbound_queue(id) on delete cascade,
 revision integer not null check(revision>0),
 created_at timestamptz not null default now(),
 primary key(business_id,conversation_id,event_id),
 foreign key(business_id,conversation_id) references public.conversations(business_id,id) on delete cascade
);
create index process_receipts_job on public.process_event_receipts(job_id);
alter table public.process_event_receipts enable row level security;
revoke all on public.process_event_receipts from public,anon,authenticated;
grant select,insert on public.process_event_receipts to service_role;
alter table public.workflow_inbound_queue add column process_prompt_targets jsonb not null default '[]'::jsonb
 check(jsonb_typeof(process_prompt_targets)='array'), add column process_presented_at timestamptz;

create function public.commit_process_checkpoint(
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
 if s.collected<>'{}'::jsonb and s.collected->>'schemaVersion' is distinct from '4' then raise exception 'state_reset_required'; end if;
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

-- Delivery changes only the still-current targets listed in the persisted outbox.
-- A late receipt cannot revive a corrected, consumed or expired confirmation.
create function public.record_process_presentation(p_business uuid,p_job bigint,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.workflow_inbound_queue; s public.conversation_states; next_state jsonb;
 target jsonb; item record; target_id text; stamp numeric; changed boolean:=false;
begin
 select * into j from public.workflow_inbound_queue where id=p_job and business_id=p_business and lease_token=p_token for update;
 if not found or j.status<>'sent' then raise exception 'delivery_receipt_required'; end if;
 if j.process_presented_at is not null then return jsonb_build_object('replayed',true); end if;
 select * into s from public.conversation_states where conversation_id=j.conversation_id and business_id=p_business for update;
 if not found or s.collected->>'schemaVersion' is distinct from '4' then raise exception 'invalid_process_state'; end if;
 next_state:=s.collected;
 stamp:=floor(extract(epoch from clock_timestamp())*1000);
 for target in select value from jsonb_array_elements(j.process_prompt_targets) loop
  target_id:=target#>>'{}';
  if (next_state->'offers'->target_id->>'expiresAt')::numeric>stamp and next_state->'offers'->target_id->>'presentedAt' is null then
   next_state:=jsonb_set(next_state,array['offers',target_id,'presentedAt'],to_jsonb(stamp)); changed:=true;
  end if;
  for item in select key,value from jsonb_each(next_state->'instances') loop
   if item.value->'wait'->>'id'=target_id and item.value->'wait'->>'kind' in ('field','approval')
    and (item.value->'wait'->>'expiresAt')::numeric>stamp and item.value->'wait'->>'presentedAt' is null then
    next_state:=jsonb_set(next_state,array['instances',item.key,'wait','presentedAt'],to_jsonb(stamp)); changed:=true;
   end if;
  end loop;
 end loop;
 if changed then
  next_state:=jsonb_set(next_state,'{revision}',to_jsonb(s.revision+1));
  update public.conversation_states set collected=next_state,revision=revision+1,updated_at=now() where conversation_id=j.conversation_id and business_id=p_business;
 end if;
 update public.workflow_inbound_queue set process_presented_at=now() where id=p_job;
 return jsonb_build_object('replayed',false,'state',next_state);
end $$;
revoke all on function public.commit_process_checkpoint(uuid,uuid,bigint,uuid,text,text,integer,jsonb,text,jsonb),public.record_process_presentation(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.commit_process_checkpoint(uuid,uuid,bigint,uuid,text,text,integer,jsonb,text,jsonb),public.record_process_presentation(uuid,bigint,uuid) to service_role;
commit;
