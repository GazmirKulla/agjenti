-- Deploy together with transport-aware workers. No customer data backfill.
-- Queue remains the single outbox; test results contain the existing sealed
-- session, not a second workflow state. No locks span AI/provider calls.
begin;
alter table public.workflow_inbound_queue
 add column operation_kind text not null default 'inbound' check(operation_kind in ('inbound','staff','test')),
 add column operator_user_id uuid references auth.users(id) on delete cascade,
 add column test_stream_id uuid,
 add column client_request_id uuid,
 add column client_sequence integer check(client_sequence between 0 and 39),
 add column request_fingerprint text,
 add column result_ciphertext text,
 add column expires_at timestamptz,
 alter column connection_id drop not null;
alter table public.workflow_inbound_queue add constraint transport_scope check (
 (operation_kind='test' and connection_id is null and conversation_id is null and operator_user_id is not null and test_stream_id is not null and client_request_id is not null and client_sequence is not null and expires_at is not null)
 or (operation_kind in ('inbound','staff') and connection_id is not null and test_stream_id is null));
create unique index transport_request on public.workflow_inbound_queue(business_id,operator_user_id,client_request_id) where client_request_id is not null;
create unique index transport_test_sequence on public.workflow_inbound_queue(business_id,operator_user_id,test_stream_id,client_sequence) where operation_kind='test';
create index transport_test_stream on public.workflow_inbound_queue(business_id,operator_user_id,test_stream_id,id) where operation_kind='test';
drop trigger pause_exhausted_workflow_conversation on public.workflow_inbound_queue;
create trigger pause_exhausted_workflow_conversation after update of status on public.workflow_inbound_queue for each row
 when (new.operation_kind<>'test' and new.status='failed' and old.status is distinct from new.status)
 execute function public.pause_exhausted_workflow_conversation();

-- Assign queue order under the same stream lock used by the claimant. Sequence
-- allocation before this lock could let a later committed request overtake it.
create function public.order_transport_enqueue() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(coalesce(new.connection_id::text,new.operator_user_id::text||':'||new.test_stream_id::text)||':'||new.participant_id,0));
 new.id:=nextval(pg_get_serial_sequence('public.workflow_inbound_queue','id'));
 return new;
end $$;
revoke all on function public.order_transport_enqueue() from public,anon,authenticated;
create trigger order_transport_enqueue before insert on public.workflow_inbound_queue for each row execute function public.order_transport_enqueue();

alter table public.messages drop constraint messages_delivery_status_check;
alter table public.messages add column transport_request_id uuid;
alter table public.messages add constraint messages_delivery_status_check check(delivery_status is null or delivery_status in ('pending','queued','sending','sent','delivered','read','failed','uncertain'));

create table public.message_transport_parts (
 id uuid primary key default gen_random_uuid(),
 job_id bigint not null references public.workflow_inbound_queue(id) on delete cascade,
 message_id uuid references public.messages(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,
 connection_id uuid not null,
 channel text not null,
 participant_id text not null,
 part_index integer not null check(part_index>=0),
 part_count integer not null check(part_count between 1 and 100),
 body text not null,
 external_message_id text,
 status text not null check(status in ('sending','sent','delivered','read','failed','uncertain')),
 error text,
 updated_at timestamptz not null default now(),
 unique(job_id,part_index), unique(connection_id,external_message_id),
 foreign key(business_id,connection_id,channel) references public.messaging_connections(business_id,id,channel) on delete cascade
);
create index message_transport_parts_message on public.message_transport_parts(message_id);
alter table public.message_transport_parts enable row level security;
revoke all on public.message_transport_parts from public,anon,authenticated;
grant select on public.message_transport_parts to authenticated;
grant select,insert,update,delete on public.message_transport_parts to service_role;
create policy transport_part_read on public.message_transport_parts for select to authenticated using(is_business_member(business_id));

-- Bounded early-receipt reconciliation. No raw webhook payloads/credentials.
create table public.message_transport_receipts (
 business_id uuid not null,
 connection_id uuid not null,
 channel text not null,
 participant_id text not null,
 external_message_id text not null,
 status text not null check(status in ('sent','delivered','read','failed')),
 occurred_at timestamptz not null,
 received_at timestamptz not null default now(),
 primary key(connection_id,participant_id,external_message_id),
 foreign key(business_id,connection_id,channel) references public.messaging_connections(business_id,id,channel) on delete cascade
);
alter table public.message_transport_receipts enable row level security;
revoke all on public.message_transport_receipts from public,anon,authenticated;
grant select,insert,update,delete on public.message_transport_receipts to service_role;

create function public.transport_status_rank(p_status text) returns integer language sql immutable as $$
 select case p_status when 'read' then 5 when 'delivered' then 4 when 'failed' then 3 when 'sent' then 2 else 0 end;
$$;
revoke all on function public.transport_status_rank(text) from public,anon,authenticated;
grant execute on function public.transport_status_rank(text) to service_role;

create function public.refresh_transport_message(p_job bigint) returns void language plpgsql security invoker set search_path=public as $$
declare result_status text; target uuid;
begin
 select min(message_id::text)::uuid,
  case when count(*)<max(part_count) then 'uncertain'
   when bool_or(status='uncertain') then 'uncertain'
   when bool_or(status='failed') then 'failed'
   when bool_and(status='read') then 'read'
   when bool_and(status in ('delivered','read')) then 'delivered'
   when bool_and(status in ('sent','delivered','read')) then 'sent' else 'sending' end
 into target,result_status from message_transport_parts where job_id=p_job;
 if target is not null then update messages set delivery_status=result_status where id=target; end if;
end $$;

create function public.record_transport_receipt(p_connection uuid,p_participant text,p_external text,p_status text,p_occurred timestamptz)
 returns void language plpgsql security invoker set search_path=public as $$
declare c messaging_connections; part message_transport_parts; receipt message_transport_receipts;
begin
 if p_status not in ('sent','delivered','read','failed') or length(p_external) not between 1 and 1024 or length(p_participant) not between 1 and 256
  or p_occurred is null or p_occurred>now()+interval '5 minutes' or p_occurred<now()-interval '7 days' then raise exception 'invalid_receipt'; end if;
 select * into c from messaging_connections where id=p_connection;
 if not found then raise exception 'invalid_connection'; end if;
 -- Both the early event and send acknowledgement lock this exact identity.
 perform pg_advisory_xact_lock(hashtextextended(p_connection::text||':'||p_external,1));
 delete from message_transport_receipts where connection_id=p_connection and received_at<now()-interval '7 days';
 if not exists(select 1 from message_transport_receipts where connection_id=p_connection and participant_id=p_participant and external_message_id=p_external)
  and (select count(*) from message_transport_receipts where connection_id=p_connection)>=10000 then raise exception 'receipt_capacity'; end if;
 insert into message_transport_receipts(business_id,connection_id,channel,participant_id,external_message_id,status,occurred_at)
 values(c.business_id,c.id,c.channel,p_participant,p_external,p_status,p_occurred)
 on conflict(connection_id,participant_id,external_message_id) do update set
  status=case when transport_status_rank(excluded.status)>transport_status_rank(message_transport_receipts.status) then excluded.status else message_transport_receipts.status end,
  occurred_at=greatest(message_transport_receipts.occurred_at,excluded.occurred_at)
 returning * into receipt;
 select * into part from message_transport_parts where connection_id=c.id and business_id=c.business_id and channel=c.channel
  and participant_id=p_participant and external_message_id=p_external for update;
 if found then
  update message_transport_parts set status=case when transport_status_rank(receipt.status)>transport_status_rank(status) then receipt.status else status end,updated_at=now() where id=part.id;
  perform refresh_transport_message(part.job_id);
 end if;
end $$;

create function public.record_transport_part(p_job bigint,p_token uuid,p_index integer,p_total integer,p_body text,p_status text,p_external text default null,p_error text default null)
 returns void language plpgsql security invoker set search_path=public as $$
declare job workflow_inbound_queue; previous message_transport_parts; receipt message_transport_receipts;
begin
 select * into job from workflow_inbound_queue where id=p_job and lease_token=p_token and status in ('sending','uncertain') for update;
 if not found or job.operation_kind='test' then raise exception 'lease_lost'; end if;
 if p_index<0 or p_total not between 1 and 100 or p_index>=p_total or p_status not in ('sending','sent','failed','uncertain') then raise exception 'invalid_part'; end if;
 if p_status='sent' and nullif(btrim(p_external),'') is null then raise exception 'receipt_required'; end if;
 if p_external is not null then
  perform pg_advisory_xact_lock(hashtextextended(job.connection_id::text||':'||p_external,1));
  select * into receipt from message_transport_receipts where connection_id=job.connection_id and participant_id=job.participant_id and external_message_id=p_external;
 end if;
 select * into previous from message_transport_parts where job_id=p_job and part_index=p_index for update;
 if found then
  if previous.body<>p_body or previous.part_count<>p_total or (previous.external_message_id is not null and previous.external_message_id is distinct from p_external) then raise exception 'part_conflict'; end if;
  if previous.status in ('sent','delivered','read') and p_status='sending' then raise exception 'part_already_sent'; end if;
 end if;
 insert into message_transport_parts(job_id,business_id,connection_id,channel,participant_id,part_index,part_count,body,status,external_message_id,error)
 values(job.id,job.business_id,job.connection_id,job.channel,job.participant_id,p_index,p_total,p_body,
  case when transport_status_rank(receipt.status)>transport_status_rank(p_status) then receipt.status else p_status end,p_external,left(p_error,500))
 on conflict(job_id,part_index) do update set status=case when message_transport_parts.status in ('delivered','read') and transport_status_rank(message_transport_parts.status)>transport_status_rank(excluded.status) then message_transport_parts.status else excluded.status end,
  external_message_id=excluded.external_message_id,error=excluded.error,updated_at=now();
 perform refresh_transport_message(p_job);
end $$;

create function public.enqueue_transport_operation(p_business uuid,p_user uuid,p_request uuid,p_kind text,p_scope uuid,p_sequence integer,p_fingerprint text,p_payload jsonb)
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
  if c.last_inbound_at is null or c.last_inbound_at<now()-interval '24 hours' then raise exception 'transport_window_closed'; end if;
  conn:=case when c.channel='whatsapp' then c.whatsapp_connection_id else c.instagram_connection_id end;
  participant:=case when c.channel='whatsapp' then c.whatsapp_participant_id else c.instagram_participant_id end;
  if conn is null or participant is null or length(btrim(p_payload->>'body')) not between 1 and 20000 or (c.channel='whatsapp' and length(p_payload->>'body')>4096) then raise exception 'transport_invalid'; end if;
  update conversations set status='paused',auto_reply=false,openai_previous_response_id=null,updated_at=now() where id=c.id;
  insert into workflow_inbound_queue(business_id,channel,connection_id,participant_id,external_id,payload,operation_kind,operator_user_id,client_request_id,request_fingerprint,conversation_id,reply,status)
   values(p_business,c.channel,conn,participant,p_request::text,jsonb_build_object('channel',c.channel,'timestamp',c.last_inbound_at),p_kind,p_user,p_request,p_fingerprint,c.id,p_payload->>'body','prepared') returning * into job;
 end if;
 return to_jsonb(job);
end $$;

-- One turn per accepted message. Existing frozen batches remain drainable.
-- The same claimant handles customer inbound, staff outbox and private tests.
create function public.claim_workflow_transport(p_businesses uuid[],p_test_user uuid,p_test_stream uuid) returns setof public.workflow_inbound_queue language plpgsql security definer set search_path=public as $$
declare candidate workflow_inbound_queue; stream text;
begin
 if p_test_user is null then
  update conversations set status='paused',auto_reply=false where id in(select conversation_id from workflow_inbound_queue where status='sending' and leased_until<now() and (p_businesses is null or business_id=any(p_businesses)));
  update workflow_inbound_queue set status='uncertain',error='Provider result requires reconciliation',leased_until=null where status='sending' and leased_until<now() and (p_businesses is null or business_id=any(p_businesses));
 end if;
 for candidate in select q.* from workflow_inbound_queue q
  where (p_businesses is null or q.business_id=any(p_businesses))
   and ((p_test_user is null and q.operation_kind<>'test') or (q.operation_kind='test' and q.operator_user_id=p_test_user and q.test_stream_id=p_test_stream))
   and (q.status in ('queued','prepared') or q.status='processing' and q.leased_until<now())
   and (q.leased_until is null or q.leased_until<now()) and (q.expires_at is null or q.expires_at>now()) order by q.id limit 100 loop
  stream:=coalesce(candidate.connection_id::text,candidate.operator_user_id::text||':'||candidate.test_stream_id::text)||':'||candidate.participant_id;
  if not pg_try_advisory_xact_lock(hashtextextended(stream,0)) then continue; end if;
  select * into candidate from workflow_inbound_queue q where q.id=candidate.id
   and (q.status in ('queued','prepared') or q.status='processing' and q.leased_until<now()) and (q.leased_until is null or q.leased_until<now())
   and not exists(select 1 from workflow_inbound_queue e where e.business_id=q.business_id and e.id<q.id
    and ((q.operation_kind='test' and e.operation_kind='test' and e.operator_user_id=q.operator_user_id and e.test_stream_id=q.test_stream_id)
      or (q.operation_kind<>'test' and e.connection_id=q.connection_id and e.participant_id=q.participant_id))
    and (e.status in ('queued','processing','prepared','sending','uncertain') or q.operation_kind='test' and e.status='failed')) for update skip locked;
  if not found then continue; end if;
  if candidate.attempts>=3 then
   update workflow_inbound_queue set status='failed',error='Processing retries exhausted' where id=candidate.id;
   continue;
  end if;
  return query update workflow_inbound_queue set status=case when status='prepared' then 'prepared' else 'processing' end,lease_token=gen_random_uuid(),leased_until=now()+interval '180 seconds',attempts=attempts+1 where id=candidate.id returning *;
  return;
 end loop;
end $$;
create or replace function public.claim_workflow_inbound_batch(p_businesses uuid[]) returns setof public.workflow_inbound_queue language sql security definer set search_path=public as $$ select * from claim_workflow_transport(p_businesses,null,null); $$;
create or replace function public.workflow_inbound_batch_wait_ms() returns integer language sql stable security definer set search_path=public as $$ select 0; $$;
-- Do not let legacy claimants bypass the unified stream lock/lease.
create or replace function public.claim_workflow_inbound(p_businesses uuid[]) returns setof public.workflow_inbound_queue language sql security definer set search_path=public as $$ select * from claim_workflow_inbound_batch(p_businesses); $$;

-- Preserve the established inbound handoff/receipt functions behind wrappers.
alter function public.begin_workflow_send(bigint,uuid) rename to begin_inbound_workflow_send;
create function public.begin_workflow_send(p_id bigint,p_token uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token and status='prepared' and leased_until>now() for update;
 if not found then return false; end if;
 if job.operation_kind='inbound' then return begin_inbound_workflow_send(p_id,p_token); end if;
 if job.operation_kind<>'staff' then return false; end if;
 if not(exists(select 1 from business_users where business_id=job.business_id and user_id=job.operator_user_id) or exists(select 1 from platform_admins where user_id=job.operator_user_id)) then
  update workflow_inbound_queue set status='failed',error='Membership revoked',leased_until=null where id=p_id; return false;
 end if;
 perform 1 from conversations where id=job.conversation_id and business_id=job.business_id and last_inbound_at>now()-interval '24 hours' for update;
 if not found then update workflow_inbound_queue set status='failed',error='Messaging window closed',leased_until=null where id=p_id; return false; end if;
 update workflow_inbound_queue set status='sending',send_started_at=clock_timestamp(),leased_until=now()+interval '120 seconds' where id=p_id;
 return true;
end $$;

alter function public.finish_workflow_send(bigint,uuid,boolean,text,text) rename to finish_inbound_workflow_send;
create function public.finish_workflow_send(p_id bigint,p_token uuid,p_ok boolean,p_external text,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue; target uuid;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token for update;
 if not found or job.operation_kind='test' then raise exception 'lease_lost'; end if;
 if job.operation_kind='inbound' then
  perform finish_inbound_workflow_send(p_id,p_token,p_ok,p_external,p_error);
 else
  if job.status='sent' and p_ok and job.provider_message_id=p_external then return; end if;
  if job.status not in ('sending','uncertain') then raise exception 'lease_lost'; end if;
  if p_ok and nullif(btrim(p_external),'') is null then raise exception 'receipt_required'; end if;
  if p_ok then
   insert into messages(business_id,conversation_id,instagram_connection_id,whatsapp_connection_id,direction,source,body,external_message_id,delivery_status,created_at)
    values(job.business_id,job.conversation_id,case when job.channel='instagram' then job.connection_id end,case when job.channel='whatsapp' then job.connection_id end,'outbound','staff',job.reply,p_external,'sent',coalesce(job.send_started_at,job.created_at)) returning id into target;
   update conversations set last_message_at=now(),last_message_preview=left(job.reply,140) where id=job.conversation_id and business_id=job.business_id and (last_message_at is null or last_message_at<=job.send_started_at);
  end if;
  update workflow_inbound_queue set status=case when p_ok then 'sent' else 'uncertain' end,provider_message_id=case when p_ok then p_external else provider_message_id end,error=p_error,leased_until=null where id=p_id;
 end if;
 if target is null and p_ok then select id into target from messages where business_id=job.business_id and conversation_id=job.conversation_id and external_message_id=p_external and direction='outbound'; end if;
 if target is null then select message_id into target from message_transport_parts where job_id=p_id and message_id is not null limit 1; end if;
 if target is null and exists(select 1 from message_transport_parts where job_id=p_id) then
  insert into messages(business_id,conversation_id,instagram_connection_id,whatsapp_connection_id,direction,source,body,delivery_status,delivery_error,created_at)
   values(job.business_id,job.conversation_id,case when job.channel='instagram' then job.connection_id end,case when job.channel='whatsapp' then job.connection_id end,'outbound',case when job.operation_kind='staff' then 'staff' else 'agent' end,job.reply,'uncertain',p_error,coalesce(job.send_started_at,job.created_at)) returning id into target;
 end if;
 if target is not null then
  update messages set transport_request_id=job.client_request_id where id=target;
  update message_transport_parts set message_id=target where job_id=p_id; perform refresh_transport_message(p_id);
 end if;
end $$;

create function public.finish_test_transport(p_id bigint,p_token uuid,p_result text,p_error text) returns void language plpgsql security invoker set search_path=public as $$
begin
 update workflow_inbound_queue set result_ciphertext=p_result,status=case when p_error is null then 'sent' else 'failed' end,error=p_error,leased_until=null
  where id=p_id and operation_kind='test' and lease_token=p_token and status='processing' and leased_until>now();
 if not found then raise exception 'lease_lost'; end if;
end $$;

revoke all on function public.refresh_transport_message(bigint),public.record_transport_receipt(uuid,text,text,text,timestamptz),public.record_transport_part(bigint,uuid,integer,integer,text,text,text,text),public.enqueue_transport_operation(uuid,uuid,uuid,text,uuid,integer,text,jsonb),public.begin_workflow_send(bigint,uuid),public.finish_workflow_send(bigint,uuid,boolean,text,text),public.finish_test_transport(bigint,uuid,text,text) from public,anon,authenticated;
grant execute on function public.refresh_transport_message(bigint),public.record_transport_receipt(uuid,text,text,text,timestamptz),public.record_transport_part(bigint,uuid,integer,integer,text,text,text,text),public.enqueue_transport_operation(uuid,uuid,uuid,text,uuid,integer,text,jsonb),public.begin_workflow_send(bigint,uuid),public.finish_workflow_send(bigint,uuid,boolean,text,text),public.finish_test_transport(bigint,uuid,text,text) to service_role;
revoke all on function public.claim_workflow_transport(uuid[],uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_workflow_transport(uuid[],uuid,uuid) to service_role;
commit;
