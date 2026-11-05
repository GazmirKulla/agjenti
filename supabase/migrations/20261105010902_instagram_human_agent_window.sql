-- Human Agent extends only authenticated staff replies on Instagram.
-- Keep membership, tenant isolation, leases, and retry idempotency unchanged.
begin;
set local lock_timeout='5s';
create or replace function public.enqueue_transport_operation(p_business uuid,p_user uuid,p_request uuid,p_kind text,p_scope uuid,p_sequence integer,p_fingerprint text,p_payload jsonb)
 returns jsonb language plpgsql security invoker set search_path=public as $$
declare c conversations; job workflow_inbound_queue; latest integer; conn uuid; participant text;
begin
 if not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'transport_forbidden'; end if;
 if p_request is null or p_scope is null or p_kind not in ('staff','test') or p_fingerprint !~ '^[a-f0-9]{64}$' or octet_length(p_payload::text)>524288 then raise exception 'transport_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_business::text||':'||p_user::text||':'||p_scope::text,2));
 select * into job from workflow_inbound_queue where business_id=p_business and operator_user_id=p_user and client_request_id=p_request;
 if found then
  if job.request_fingerprint<>p_fingerprint or job.operation_kind<>p_kind or (p_kind='test' and job.test_stream_id<>p_scope) or (p_kind='staff' and job.conversation_id<>p_scope) then raise exception 'transport_request_conflict'; end if;
  return to_jsonb(job);
 end if;
 if p_kind='test' then
  select max(client_sequence) into latest from workflow_inbound_queue where business_id=p_business and operator_user_id=p_user and test_stream_id=p_scope;
  if latest is not null and p_sequence<>latest+1 then raise exception 'transport_sequence_conflict'; end if;
  if latest is not null and exists(select 1 from workflow_inbound_queue where business_id=p_business and operator_user_id=p_user and test_stream_id=p_scope and expires_at<=now()) then raise exception 'transport_expired'; end if;
  insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,operation_kind,operator_user_id,test_stream_id,client_request_id,client_sequence,request_fingerprint,expires_at)
   values(p_business,null,p_user::text,p_request::text,p_payload,p_kind,p_user,p_scope,p_request,p_sequence,p_fingerprint,now()+interval '1 hour') returning * into job;
 else
  select * into c from conversations where id=p_scope and business_id=p_business;
  if not found then raise exception 'transport_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(c.whatsapp_connection_id,c.instagram_connection_id)::text||':'||coalesce(c.whatsapp_participant_id,c.instagram_participant_id),0));
  select * into c from conversations where id=p_scope and business_id=p_business for update;
  if not found then raise exception 'transport_not_found'; end if;
  if c.last_inbound_at is null or c.last_inbound_at<=now()-(case when c.channel='instagram' then interval '7 days' else interval '24 hours' end) then raise exception 'transport_window_closed'; end if;
  conn:=case when c.channel='whatsapp' then c.whatsapp_connection_id else c.instagram_connection_id end;
  participant:=case when c.channel='whatsapp' then c.whatsapp_participant_id else c.instagram_participant_id end;
  if conn is null or participant is null or length(btrim(p_payload->>'body')) not between 1 and 20000 or (c.channel='whatsapp' and length(p_payload->>'body')>4096) then raise exception 'transport_invalid'; end if;
  update conversations set status='paused',auto_reply=false,openai_previous_response_id=null,updated_at=now() where id=c.id;
  insert into workflow_inbound_queue(business_id,channel,connection_id,participant_id,external_id,payload,operation_kind,operator_user_id,client_request_id,request_fingerprint,conversation_id,reply,status)
   values(p_business,c.channel,conn,participant,p_request::text,jsonb_build_object('channel',c.channel,'timestamp',c.last_inbound_at),p_kind,p_user,p_request,p_fingerprint,c.id,p_payload->>'body','prepared') returning * into job;
 end if;
 return to_jsonb(job);
end $$;

create or replace function public.begin_workflow_send(p_id bigint,p_token uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token and status='prepared' and leased_until>now() for update;
 if not found then return false; end if;
 if job.operation_kind='inbound' then return begin_inbound_workflow_send(p_id,p_token); end if;
 if job.operation_kind<>'staff' then return false; end if;
 if not(exists(select 1 from business_users where business_id=job.business_id and user_id=job.operator_user_id) or exists(select 1 from platform_admins where user_id=job.operator_user_id)) then
  update workflow_inbound_queue set status='failed',error='Membership revoked',leased_until=null where id=p_id; return false;
 end if;
 perform 1 from conversations where id=job.conversation_id and business_id=job.business_id and last_inbound_at>clock_timestamp()-(case when channel='instagram' then interval '7 days' else interval '24 hours' end) for update;
 if not found then update workflow_inbound_queue set status='failed',error='Messaging window closed',leased_until=null where id=p_id; return false; end if;
 update workflow_inbound_queue set status='sending',send_started_at=clock_timestamp(),leased_until=now()+interval '120 seconds' where id=p_id;
 return true;
end $$;

create or replace function public.retry_staff_transport(p_business uuid,p_user uuid,p_conversation uuid,p_request uuid,p_attempt integer)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare job public.workflow_inbound_queue;
begin
 if not(exists(select 1 from public.business_users where business_id=p_business and user_id=p_user)
   or exists(select 1 from public.platform_admins where user_id=p_user)) then raise exception 'transport_forbidden'; end if;
 select * into job from public.workflow_inbound_queue where business_id=p_business and operator_user_id=p_user
  and conversation_id=p_conversation and client_request_id=p_request and operation_kind='staff' for update;
 if not found then raise exception 'transport_not_found'; end if;
 if p_attempt is null or p_attempt<1 then raise exception 'transport_invalid'; end if;
 -- A duplicate click/network replay cannot rearm a later failed attempt.
 if job.attempts<>p_attempt or job.status in ('prepared','sending','sent') then return to_jsonb(job); end if;
 if job.status<>'uncertain' or job.attempts>=3
  or (select count(*) from public.message_transport_parts where job_id=job.id)<>1
  or not exists(select 1 from public.message_transport_parts where job_id=job.id and part_index=0 and status='failed' and external_message_id is null)
  then raise exception 'transport_retry_unsafe'; end if;
 if not exists(select 1 from public.conversations where id=p_conversation and business_id=p_business and last_inbound_at>now()-(case when channel='instagram' then interval '7 days' else interval '24 hours' end)) then raise exception 'transport_window_closed'; end if;
 update public.workflow_inbound_queue set status='prepared',leased_until=null,error=null where id=job.id returning * into job;
 return to_jsonb(job);
end $$;
commit;
