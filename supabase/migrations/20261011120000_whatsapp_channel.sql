begin;
create table public.whatsapp_connections (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null unique references public.businesses(id) on delete cascade,
 phone_number_id text not null unique,
 waba_id text not null,
 display_phone_number text,
 verified_name text,
 access_token_ciphertext text not null,
 status text not null default 'connected' check(status in ('connected','disconnected','revoked')),
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.whatsapp_connections enable row level security;
revoke all on public.whatsapp_connections from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_connections to service_role;

-- Registry preserves foreign keys and cascade deletion for both channel adapters.
create table public.messaging_connections (
 id uuid primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 channel text not null check(channel in ('instagram','whatsapp')),
 unique(business_id,id,channel)
);
alter table public.messaging_connections enable row level security;
revoke all on public.messaging_connections from public,anon,authenticated;
grant select on public.messaging_connections to service_role;
insert into public.messaging_connections select id,business_id,'instagram' from public.instagram_connections;
create function public.sync_messaging_connection() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='DELETE' then delete from messaging_connections where id=old.id; return old; end if;
 insert into messaging_connections(id,business_id,channel) values(new.id,new.business_id,TG_ARGV[0])
 on conflict(id) do update set business_id=excluded.business_id;
 return new;
end $$;
revoke all on function public.sync_messaging_connection() from public,anon,authenticated;
create trigger instagram_messaging_connection after insert or update or delete on public.instagram_connections for each row execute function public.sync_messaging_connection('instagram');
create trigger whatsapp_messaging_connection after insert or update or delete on public.whatsapp_connections for each row execute function public.sync_messaging_connection('whatsapp');

alter table public.customers add column whatsapp_user_id text;
create unique index customers_whatsapp_identity on public.customers(business_id,whatsapp_user_id) where whatsapp_user_id is not null;

alter table public.conversations add column channel text not null default 'instagram' check(channel in ('instagram','whatsapp')),
 add column whatsapp_participant_id text,
 add column whatsapp_connection_id uuid references public.whatsapp_connections(id) on delete set null;
alter table public.messages add column whatsapp_connection_id uuid references public.whatsapp_connections(id) on delete set null;
create unique index whatsapp_open_conversation on public.conversations(business_id,whatsapp_connection_id,whatsapp_participant_id) where whatsapp_participant_id is not null and status in ('active','paused');
create unique index whatsapp_message_external on public.messages(whatsapp_connection_id,external_message_id) where external_message_id is not null;
alter table public.conversations add constraint conversation_channel_identity check (
 (channel='instagram' and whatsapp_participant_id is null and whatsapp_connection_id is null) or
 (channel='whatsapp' and instagram_participant_id is null and instagram_connection_id is null));

alter table public.workflow_inbound_queue add column channel text not null default 'instagram' check(channel in ('instagram','whatsapp')),
 drop constraint workflow_inbound_queue_connection_id_fkey,
 add foreign key(business_id,connection_id,channel) references public.messaging_connections(business_id,id,channel) on delete cascade;
alter table public.conversation_profiles add column channel text not null default 'instagram' check(channel in ('instagram','whatsapp')),
 drop constraint conversation_profiles_connection_id_fkey,
 drop constraint conversation_profiles_pkey,
 add primary key(business_id,participant_id,channel),
 add foreign key(business_id,connection_id,channel) references public.messaging_connections(business_id,id,channel) on delete cascade;

create or replace function public.claim_workflow_inbound(p_businesses uuid[]) returns setof public.workflow_inbound_queue language plpgsql security definer set search_path=public as $$
declare candidate public.workflow_inbound_queue;
begin
 -- A send may have reached Meta before the worker died. Never resend it automatically.
 update conversations set status='paused',auto_reply=false where id in (select conversation_id from workflow_inbound_queue where (channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now());
 update workflow_inbound_queue set status='uncertain',error='Delivery requires staff verification' where (channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now();
 for candidate in select q.* from workflow_inbound_queue q where (q.channel='whatsapp' or q.business_id=any(p_businesses)) and (q.status in ('queued','prepared') or(q.status='processing' and q.leased_until<now())) and (q.leased_until is null or q.leased_until<now())
  and not exists(select 1 from workflow_inbound_queue earlier where earlier.connection_id=q.connection_id and earlier.participant_id=q.participant_id and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending'))
  order by q.id for update skip locked limit 20 loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.connection_id::text||':'||candidate.participant_id,0)) then continue; end if;
  if candidate.attempts>=3 then
   update workflow_inbound_queue set status='failed',error='Processing retries exhausted' where id=candidate.id;
   update conversations set status='paused',auto_reply=false where business_id=candidate.business_id and channel=candidate.channel and coalesce(whatsapp_participant_id,instagram_participant_id)=candidate.participant_id and coalesce(whatsapp_connection_id,instagram_connection_id)=candidate.connection_id and status='active';
   continue;
  end if;
  return query update workflow_inbound_queue set status=case when status='prepared' then 'prepared' else 'processing' end,lease_token=gen_random_uuid(),leased_until=now()+interval '120 seconds',attempts=attempts+1 where id=candidate.id returning *;
  return;
 end loop;
end $$;

create or replace function public.save_workflow_booking(
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
  and channel=job.channel and coalesce(whatsapp_participant_id,instagram_participant_id)=job.participant_id and coalesce(whatsapp_connection_id,instagram_connection_id)=job.connection_id for update;
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

create or replace function public.prepare_workflow_reply(p_id bigint,p_token uuid,p_conversation uuid,p_revision integer,p_state jsonb,p_workflow uuid,p_reply text,p_response text,p_handoff boolean)
returns void language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue; current_revision integer; c conversations; enabled boolean;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token and status='processing' and leased_until>now() for update;
 if not found then raise exception 'lease_lost'; end if;
 select * into c from conversations where id=p_conversation and business_id=job.business_id and channel=job.channel and coalesce(whatsapp_participant_id,instagram_participant_id)=job.participant_id and coalesce(whatsapp_connection_id,instagram_connection_id)=job.connection_id for update;
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
 insert into conversation_profiles(business_id,participant_id,connection_id,channel,profile) values(job.business_id,job.participant_id,job.connection_id,job.channel,coalesce(p_state->'context'->'profile','{}'))
 on conflict(business_id,participant_id,channel) do update set profile=conversation_profiles.profile||excluded.profile,connection_id=excluded.connection_id,updated_at=now();
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

create or replace function public.finish_workflow_send(p_id bigint,p_token uuid,p_ok boolean,p_external text,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare job public.workflow_inbound_queue;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token and status='sending' for update;
 if not found then raise exception 'lease_lost'; end if;
 if p_ok then
  insert into messages(business_id,conversation_id,instagram_connection_id,whatsapp_connection_id,direction,source,body,external_message_id,delivery_status) values(job.business_id,job.conversation_id,case when job.channel='instagram' then job.connection_id end,case when job.channel='whatsapp' then job.connection_id end,'outbound','agent',job.reply,p_external,'sent');
  update conversations set openai_previous_response_id=job.response_id,last_message_at=now(),last_message_preview=left(job.reply,140) where id=job.conversation_id;
 else
  update conversations set status='paused',auto_reply=false where id=job.conversation_id;
 end if;
 insert into agent_turns(business_id,conversation_id,status,reply) values(job.business_id,job.conversation_id,case when p_ok then 'ok' else 'failed' end,job.reply);
 update workflow_inbound_queue set status=case when p_ok then 'sent' else 'uncertain' end,error=p_error,leased_until=null where id=p_id;
end $$;
-- A business can launch with either connected messaging channel.
alter function public.business_setup_status(uuid) rename to pre_whatsapp_business_setup_status;
create function public.business_setup_status(p_business_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare base jsonb;
begin
 base:=pre_whatsapp_business_setup_status(p_business_id);
 return base||jsonb_build_object('connected',coalesce((base->>'connected')::boolean,false) or exists(select 1 from whatsapp_connections where business_id=p_business_id and status='connected'));
end $$;
revoke all on function public.business_setup_status(uuid),public.pre_whatsapp_business_setup_status(uuid) from public,anon,authenticated;
grant execute on function public.business_setup_status(uuid),public.pre_whatsapp_business_setup_status(uuid) to service_role;
commit;
