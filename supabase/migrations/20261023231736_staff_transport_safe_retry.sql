-- Retry is an explicit, attempt-fenced rearm of the SAME outbox operation.
-- Only a definite rejection BEFORE ANY accepted/ambiguous part is eligible.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function public.retry_staff_transport(p_business uuid,p_user uuid,p_conversation uuid,p_request uuid,p_attempt integer)
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
 if not exists(select 1 from public.conversations where id=p_conversation and business_id=p_business and last_inbound_at>now()-interval '24 hours') then raise exception 'transport_window_closed'; end if;
 update public.workflow_inbound_queue set status='prepared',leased_until=null,error=null where id=job.id returning * into job;
 return to_jsonb(job);
end $$;
revoke all on function public.retry_staff_transport(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.retry_staff_transport(uuid,uuid,uuid,uuid,integer) to service_role;

create or replace function public.finish_workflow_send(p_id bigint,p_token uuid,p_ok boolean,p_external text,p_error text) returns void language plpgsql security definer set search_path=public as $$
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
  select message_id into target from message_transport_parts where job_id=p_id and message_id is not null limit 1;
  if p_ok then
   if target is not null then
    update messages set external_message_id=p_external,delivery_status='sent',delivery_error=null
     where id=target and business_id=job.business_id and conversation_id=job.conversation_id;
   else
   insert into messages(business_id,conversation_id,instagram_connection_id,whatsapp_connection_id,direction,source,body,external_message_id,delivery_status,created_at)
    values(job.business_id,job.conversation_id,case when job.channel='instagram' then job.connection_id end,case when job.channel='whatsapp' then job.connection_id end,'outbound','staff',job.reply,p_external,'sent',coalesce(job.send_started_at,job.created_at)) returning id into target;
   end if;
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
  update messages set transport_request_id=job.client_request_id,delivery_error=case when p_ok then null else p_error end where id=target;
  update message_transport_parts set message_id=target where job_id=p_id; perform refresh_transport_message(p_id);
 end if;
end $$;
commit;
