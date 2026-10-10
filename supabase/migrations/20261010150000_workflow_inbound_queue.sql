begin;
create table public.workflow_inbound_queue (
 id bigint generated always as identity primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 connection_id uuid not null references public.instagram_connections(id) on delete cascade,
 participant_id text not null,
 external_id text not null,
 payload jsonb not null,
 status text not null default 'queued' check(status in ('queued','processing','prepared','sending','sent','ignored','failed','uncertain')),
 attempts integer not null default 0,
 lease_token uuid,
 leased_until timestamptz,
 conversation_id uuid references public.conversations(id) on delete cascade,
 reply text,
 response_id text,
 error text,
 created_at timestamptz not null default now(),
 unique(connection_id,external_id)
);
create index on public.workflow_inbound_queue(business_id,participant_id,id);
alter table public.workflow_inbound_queue enable row level security;
revoke all on public.workflow_inbound_queue from public,anon,authenticated;
grant select,insert,update,delete on public.workflow_inbound_queue to service_role;
grant usage,select on sequence public.workflow_inbound_queue_id_seq to service_role;

create function public.claim_workflow_inbound(p_businesses uuid[]) returns setof public.workflow_inbound_queue language plpgsql security definer set search_path=public as $$
declare candidate public.workflow_inbound_queue;
begin
 -- A send may have reached Meta before the worker died. Never resend it automatically.
 update conversations set status='paused',auto_reply=false where id in (select conversation_id from workflow_inbound_queue where business_id=any(p_businesses) and status='sending' and leased_until<now());
 update workflow_inbound_queue set status='uncertain',error='Delivery requires staff verification' where business_id=any(p_businesses) and status='sending' and leased_until<now();
 for candidate in select q.* from workflow_inbound_queue q where q.business_id=any(p_businesses) and (q.status in ('queued','prepared') or(q.status='processing' and q.leased_until<now())) and (q.leased_until is null or q.leased_until<now())
  and not exists(select 1 from workflow_inbound_queue earlier where earlier.business_id=q.business_id and earlier.participant_id=q.participant_id and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending'))
  order by q.id for update skip locked limit 20 loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.business_id::text||':'||candidate.participant_id,0)) then continue; end if;
  if candidate.attempts>=3 then
   update workflow_inbound_queue set status='failed',error='Processing retries exhausted' where id=candidate.id;
   update conversations set status='paused',auto_reply=false where business_id=candidate.business_id and instagram_participant_id=candidate.participant_id and status='active';
   continue;
  end if;
  return query update workflow_inbound_queue set status=case when status='prepared' then 'prepared' else 'processing' end,lease_token=gen_random_uuid(),leased_until=now()+interval '120 seconds',attempts=attempts+1 where id=candidate.id returning *;
  return;
 end loop;
end $$;

create function public.prepare_workflow_reply(p_id bigint,p_token uuid,p_conversation uuid,p_revision integer,p_state jsonb,p_workflow uuid,p_reply text,p_response text,p_handoff boolean)
returns void language plpgsql security definer set search_path=public as $$
declare job public.workflow_inbound_queue; current_revision integer;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token and status='processing' and leased_until>now() for update;
 if not found then raise exception 'lease_lost'; end if;
 perform 1 from conversations where id=p_conversation and business_id=job.business_id and instagram_participant_id=job.participant_id for update;
 if not found then raise exception 'invalid_conversation'; end if;
 if p_workflow is not null and not exists(select 1 from workflows where id=p_workflow and business_id=job.business_id) then raise exception 'invalid_workflow'; end if;
 select revision into current_revision from conversation_states where conversation_id=p_conversation for update;
 if current_revision is distinct from p_revision then raise exception 'stale_state'; end if;
 update conversation_states set collected=p_state,workflow_id=p_workflow,step_key=p_state->>'step_key',status=case when p_state->>'step_key'='order_ready' then 'ready' else 'in_progress' end,revision=revision+1,updated_at=now() where conversation_id=p_conversation and business_id=job.business_id;
 insert into conversation_profiles(business_id,participant_id,connection_id,profile) values(job.business_id,job.participant_id,job.connection_id,coalesce(p_state->'context'->'profile','{}'))
 on conflict(business_id,participant_id) do update set profile=conversation_profiles.profile||excluded.profile,connection_id=excluded.connection_id,updated_at=now();
 if p_handoff then update conversations set status='paused',auto_reply=false where id=p_conversation; end if;
 update workflow_inbound_queue set status='prepared',conversation_id=p_conversation,reply=p_reply,response_id=p_response where id=p_id;
end $$;

create function public.begin_workflow_send(p_id bigint,p_token uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update workflow_inbound_queue set status='sending',leased_until=now()+interval '120 seconds' where id=p_id and lease_token=p_token and status='prepared' and leased_until>now();
 return found;
end $$;

create function public.finish_workflow_send(p_id bigint,p_token uuid,p_ok boolean,p_external text,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare job public.workflow_inbound_queue;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token and status='sending' for update;
 if not found then raise exception 'lease_lost'; end if;
 if p_ok then
  insert into messages(business_id,conversation_id,instagram_connection_id,direction,source,body,external_message_id,delivery_status) values(job.business_id,job.conversation_id,job.connection_id,'outbound','agent',job.reply,p_external,'sent');
  update conversations set openai_previous_response_id=job.response_id,last_message_at=now(),last_message_preview=left(job.reply,140) where id=job.conversation_id;
 else
  update conversations set status='paused',auto_reply=false where id=job.conversation_id;
 end if;
 insert into agent_turns(business_id,conversation_id,status,reply) values(job.business_id,job.conversation_id,case when p_ok then 'ok' else 'failed' end,job.reply);
 update workflow_inbound_queue set status=case when p_ok then 'sent' else 'uncertain' end,error=p_error,leased_until=null where id=p_id;
end $$;
revoke all on function public.claim_workflow_inbound(uuid[]),public.prepare_workflow_reply(bigint,uuid,uuid,integer,jsonb,uuid,text,text,boolean),public.begin_workflow_send(bigint,uuid),public.finish_workflow_send(bigint,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.claim_workflow_inbound(uuid[]),public.prepare_workflow_reply(bigint,uuid,uuid,integer,jsonb,uuid,text,text,boolean),public.begin_workflow_send(bigint,uuid),public.finish_workflow_send(bigint,uuid,boolean,text,text) to service_role;
commit;
