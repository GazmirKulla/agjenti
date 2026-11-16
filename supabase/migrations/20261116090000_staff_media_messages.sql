-- Staff can send a photo to the customer (the business's processed design, for approval), with an
-- optional caption (docs/plan-dergimi-i-fotove.md). The transport guarantees do not change: one request
-- is sent once, an ambiguous result is never replayed, and the messaging windows stay as they are.
--
-- * enqueue_transport_operation: payload.media = {"kind": "image", "url": "https://…"} with an optional
--   body (caption, up to 1000 characters); without media the body is required as before. The job keeps
--   the media in its payload and the caption in reply.
-- * finish_workflow_send: the sent (or uncertain) message is stored with its media, so the photo shows in
--   the conversation; the preview says "Foto" when there is no caption.
--
-- Requires 20261105010902_instagram_human_agent_window.sql and 20261023231736_staff_transport_safe_retry.sql.
-- Rollback: recreate both functions from those migrations.
begin;
set local lock_timeout='5s';

create or replace function public.enqueue_transport_operation(p_business uuid,p_user uuid,p_request uuid,p_kind text,p_scope uuid,p_sequence integer,p_fingerprint text,p_payload jsonb)
 returns jsonb language plpgsql security invoker set search_path=public as $$
declare c conversations; job workflow_inbound_queue; latest integer; conn uuid; participant text; media jsonb; caption text;
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
  -- A photo (the business's processed design) with an optional caption, or text as before.
  media:=p_payload->'media';
  caption:=nullif(btrim(coalesce(p_payload->>'body','')),'');
  if media is not null and (jsonb_typeof(media) is distinct from 'object' or media->>'kind' is distinct from 'image'
    or coalesce(media->>'url','') !~ '^https://[^[:space:]]+$' or length(media->>'url')>2000 or length(coalesce(caption,''))>1000) then raise exception 'transport_invalid'; end if;
  if conn is null or participant is null or (media is null and caption is null) or length(coalesce(caption,''))>20000
    or (c.channel='whatsapp' and length(coalesce(caption,''))>4096) then raise exception 'transport_invalid'; end if;
  update conversations set status='paused',auto_reply=false,openai_previous_response_id=null,updated_at=now() where id=c.id;
  insert into workflow_inbound_queue(business_id,channel,connection_id,participant_id,external_id,payload,operation_kind,operator_user_id,client_request_id,request_fingerprint,conversation_id,reply,status)
   values(p_business,c.channel,conn,participant,p_request::text,jsonb_build_object('channel',c.channel,'timestamp',c.last_inbound_at)
     ||case when media is not null then jsonb_build_object('media',jsonb_build_object('kind','image','url',media->>'url')) else '{}'::jsonb end,
    p_kind,p_user,p_request,p_fingerprint,c.id,caption,'prepared') returning * into job;
 end if;
 return to_jsonb(job);
end $$;

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
   insert into messages(business_id,conversation_id,instagram_connection_id,whatsapp_connection_id,direction,source,body,media,external_message_id,delivery_status,created_at)
    values(job.business_id,job.conversation_id,case when job.channel='instagram' then job.connection_id end,case when job.channel='whatsapp' then job.connection_id end,'outbound','staff',job.reply,
     case when job.payload ? 'media' then jsonb_build_array(jsonb_build_object('kind','image','sourceUrl',job.payload#>>'{media,url}','caption',job.reply)) end,p_external,'sent',coalesce(job.send_started_at,job.created_at)) returning id into target;
   end if;
   update conversations set last_message_at=now(),last_message_preview=left(coalesce(job.reply,case when job.payload ? 'media' then 'Foto' end),140) where id=job.conversation_id and business_id=job.business_id and (last_message_at is null or last_message_at<=job.send_started_at);
  end if;
  update workflow_inbound_queue set status=case when p_ok then 'sent' else 'uncertain' end,provider_message_id=case when p_ok then p_external else provider_message_id end,error=p_error,leased_until=null where id=p_id;
 end if;
 if target is null and p_ok then select id into target from messages where business_id=job.business_id and conversation_id=job.conversation_id and external_message_id=p_external and direction='outbound'; end if;
 if target is null then select message_id into target from message_transport_parts where job_id=p_id and message_id is not null limit 1; end if;
 if target is null and exists(select 1 from message_transport_parts where job_id=p_id) then
  insert into messages(business_id,conversation_id,instagram_connection_id,whatsapp_connection_id,direction,source,body,media,delivery_status,delivery_error,created_at)
   values(job.business_id,job.conversation_id,case when job.channel='instagram' then job.connection_id end,case when job.channel='whatsapp' then job.connection_id end,'outbound',case when job.operation_kind='staff' then 'staff' else 'agent' end,job.reply,
    case when job.payload ? 'media' then jsonb_build_array(jsonb_build_object('kind','image','sourceUrl',job.payload#>>'{media,url}','caption',job.reply)) end,'uncertain',p_error,coalesce(job.send_started_at,job.created_at)) returning id into target;
 end if;
 if target is not null then
  update messages set transport_request_id=job.client_request_id,delivery_error=case when p_ok then null else p_error end where id=target;
  update message_transport_parts set message_id=target where job_id=p_id; perform refresh_transport_message(p_id);
 end if;
end $$;

notify pgrst, 'reload schema';
commit;
