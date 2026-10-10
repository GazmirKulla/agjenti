begin;

-- A local reservation and its replay receipt commit together. This table follows
-- the same tenant/connection deletion path as the inbound queue.
create table public.workflow_booking_effects (
 job_id bigint primary key references public.workflow_inbound_queue(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 request_key text not null,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(business_id,request_key)
);
alter table public.workflow_booking_effects enable row level security;
revoke all on public.workflow_booking_effects from public,anon,authenticated;
grant select on public.workflow_booking_effects to service_role;

create function public.save_workflow_booking(
 p_job bigint,p_token uuid,p_conversation uuid,p_revision integer,
 p_service uuid,p_name text,p_contact text,p_start timestamptz,
 p_status text,p_notes text,p_request_key text
) returns public.bookings language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue; c conversations; b bookings; current_revision integer; enabled boolean;
begin
 select * into job from workflow_inbound_queue where id=p_job and lease_token=p_token
  and status='processing' and leased_until>now() for update;
 if not found then raise exception 'lease_lost'; end if;
 select * into c from conversations where id=p_conversation and business_id=job.business_id
  and instagram_participant_id=job.participant_id and instagram_connection_id=job.connection_id for update;
 if not found then raise exception 'invalid_conversation'; end if;
 select coalesce(c.auto_reply,auto_reply,false) into enabled from businesses where id=job.business_id for update;
 if c.status<>'active' or not enabled then raise exception 'ownership_lost'; end if;
 select revision into current_revision from conversation_states where conversation_id=p_conversation and business_id=job.business_id for update;
 if current_revision is distinct from p_revision then raise exception 'stale_state'; end if;
 if p_request_key is null or p_request_key not like 'ig:'||p_conversation::text||':%' or length(p_request_key)>200
  or p_status not in ('pending','confirmed') then raise exception 'invalid_booking_effect'; end if;
 select booked.* into b from workflow_booking_effects e join bookings booked on booked.id=e.booking_id
  where e.job_id=p_job and e.business_id=job.business_id and e.conversation_id=p_conversation and e.request_key=p_request_key;
 if found then return b; end if;
 b:=save_calendar_booking(job.business_id,null,0,p_service,p_name,p_contact,p_start,p_status,p_notes,p_request_key);
 insert into workflow_booking_effects(job_id,business_id,conversation_id,request_key,booking_id)
  values(p_job,job.business_id,p_conversation,p_request_key,b.id)
  on conflict(business_id,request_key) do nothing;
 return b;
end $$;

-- Check ownership again at commit; an answer generated before staff takeover
-- must not replace the staff's state or be delivered afterwards.
create or replace function public.prepare_workflow_reply(p_id bigint,p_token uuid,p_conversation uuid,p_revision integer,p_state jsonb,p_workflow uuid,p_reply text,p_response text,p_handoff boolean)
returns void language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue; current_revision integer; c conversations; enabled boolean;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token and status='processing' and leased_until>now() for update;
 if not found then raise exception 'lease_lost'; end if;
 select * into c from conversations where id=p_conversation and business_id=job.business_id and instagram_participant_id=job.participant_id for update;
 if not found then raise exception 'invalid_conversation'; end if;
 select coalesce(c.auto_reply,auto_reply,false) into enabled from businesses where id=job.business_id for update;
 if c.status<>'active' or not enabled then
  update workflow_inbound_queue set status='ignored',conversation_id=p_conversation,leased_until=null,error='Staff controls this conversation' where id=p_id;
  return;
 end if;
 if p_workflow is not null and not exists(select 1 from workflows where id=p_workflow and business_id=job.business_id) then raise exception 'invalid_workflow'; end if;
 select revision into current_revision from conversation_states where conversation_id=p_conversation for update;
 if current_revision is distinct from p_revision then raise exception 'stale_state'; end if;
 update conversation_states set collected=p_state,workflow_id=p_workflow,step_key=p_state->>'step_key',status=case when p_state->>'step_key'='order_ready' then 'ready' else 'in_progress' end,revision=revision+1,updated_at=now() where conversation_id=p_conversation and business_id=job.business_id;
 insert into conversation_profiles(business_id,participant_id,connection_id,profile) values(job.business_id,job.participant_id,job.connection_id,coalesce(p_state->'context'->'profile','{}'))
 on conflict(business_id,participant_id) do update set profile=conversation_profiles.profile||excluded.profile,connection_id=excluded.connection_id,updated_at=now();
 if p_handoff then update conversations set status='paused',auto_reply=false where id=p_conversation; end if;
 update workflow_inbound_queue set status='prepared',conversation_id=p_conversation,reply=p_reply,response_id=p_response where id=p_id;
end $$;

create or replace function public.begin_workflow_send(p_id bigint,p_token uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue; c conversations; enabled boolean;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token and status='prepared' and leased_until>now() for update;
 if not found then return false; end if;
 select * into c from conversations where id=job.conversation_id and business_id=job.business_id for update;
 if not found then return false; end if;
 select coalesce(c.auto_reply,auto_reply,false) into enabled from businesses where id=job.business_id;
 if c.status<>'active' or not enabled then
  update workflow_inbound_queue set status='ignored',leased_until=null,error='Staff controls this conversation' where id=p_id;
  return false;
 end if;
 update workflow_inbound_queue set status='sending',leased_until=now()+interval '120 seconds' where id=p_id;
 return true;
end $$;

create table public.workflow_worker_health (
 id boolean primary key default true check(id),
 last_success_at timestamptz not null,
 processed integer not null default 0
);
alter table public.workflow_worker_health enable row level security;
revoke all on public.workflow_worker_health from public,anon,authenticated;
grant select,insert,update on public.workflow_worker_health to service_role;

create function public.workflow_runtime_readiness() returns jsonb language plpgsql security definer set search_path=public as $$
declare scheduled boolean:=false; heartbeat timestamptz;
begin
 if to_regclass('cron.job') is not null then
  execute 'select exists(select 1 from cron.job where jobname=$1 and active and schedule=$2)' into scheduled using 'agjenti-workflow-inbound','* * * * *';
 end if;
 select last_success_at into heartbeat from workflow_worker_health where id;
 return jsonb_build_object('schemaVersion',3,'scheduled',scheduled,'lastSuccessAt',heartbeat);
end $$;
revoke all on function public.save_workflow_booking(bigint,uuid,uuid,integer,uuid,text,text,timestamptz,text,text,text),public.workflow_runtime_readiness() from public,anon,authenticated;
grant execute on function public.save_workflow_booking(bigint,uuid,uuid,integer,uuid,text,text,timestamptz,text,text,text),public.workflow_runtime_readiness() to service_role;
commit;
