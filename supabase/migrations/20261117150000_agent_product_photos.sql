-- The agent can send the photos of the catalog products it presented in a reply, after the reply's text.
-- The model never names a URL: the server decides which presented products have a photo, this function
-- re-reads each photo from the business's own active products, and the queue sends text then photos as
-- parts of one job (each part recorded before the next; an unknown result is never replayed).
--
-- * workflow_inbound_queue.reply_media: the photos fixed for a prepared agent reply, set once before sending.
-- * attach_workflow_reply_media: only on the job's own lease, while it is prepared and not yet sending.
-- * finish_workflow_send: the agent's message keeps those photos, so the conversation shows them.
-- * valid_agent_communication: optional business preference productPhotos ('send' | 'off').
--
-- Rollback: recreate finish_workflow_send from 20261116090000_staff_media_messages.sql and
-- valid_agent_communication from 20261104200251_agent_communication_configuration.sql (after removing
-- productPhotos from ai_agents.communication, configuration_draft and agent_configuration_versions),
-- then drop attach_workflow_reply_media and the reply_media column.
begin;
set local lock_timeout='5s';

alter table public.workflow_inbound_queue add column if not exists reply_media jsonb;

create or replace function public.attach_workflow_reply_media(p_business uuid,p_job bigint,p_token uuid,p_products jsonb)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare j workflow_inbound_queue; item jsonb; product uuid; url text; normalized jsonb:='[]'::jsonb;
begin
 select * into j from workflow_inbound_queue where id=p_job and business_id=p_business and lease_token=p_token for update;
 if not found or j.operation_kind is distinct from 'inbound' or j.status<>'prepared' or j.send_started_at is not null
  or j.leased_until is null or j.leased_until<=clock_timestamp() then raise exception 'lease_lost'; end if;
 -- The first decision for a prepared reply is final; a replayed turn never changes what is sent.
 if j.reply_media is not null then return j.reply_media; end if;
 if jsonb_typeof(p_products) is distinct from 'array' or jsonb_array_length(p_products) not between 1 and 3 then raise exception 'invalid_reply_media'; end if;
 for item in select value from jsonb_array_elements(p_products) loop
  if jsonb_typeof(item) is distinct from 'string' or item#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_reply_media'; end if;
  product:=(item#>>'{}')::uuid;
  if normalized @> jsonb_build_array(jsonb_build_object('productId',product::text)) then raise exception 'invalid_reply_media'; end if;
  select btrim(image_url) into url from products where id=product and business_id=p_business and is_active and archived_at is null;
  if url is null or url !~ '^https://[^[:space:]]+$' or length(url)>2000 then raise exception 'invalid_reply_media'; end if;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('kind','image','productId',product::text,'url',url));
 end loop;
 update workflow_inbound_queue set reply_media=normalized where id=p_job;
 return normalized;
end $$;

create or replace function public.finish_workflow_send(p_id bigint,p_token uuid,p_ok boolean,p_external text,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue; target uuid; agent_media jsonb;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token for update;
 if not found or job.operation_kind='test' then raise exception 'lease_lost'; end if;
 if job.operation_kind='inbound' and jsonb_typeof(job.reply_media)='array' then
  select jsonb_agg(jsonb_build_object('kind','image','sourceUrl',m->>'url','productId',m->>'productId') order by n) into agent_media
   from jsonb_array_elements(job.reply_media) with ordinality as x(m,n);
 end if;
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
    coalesce(case when job.payload ? 'media' then jsonb_build_array(jsonb_build_object('kind','image','sourceUrl',job.payload#>>'{media,url}','caption',job.reply)) end,agent_media),
    'uncertain',p_error,coalesce(job.send_started_at,job.created_at)) returning id into target;
 end if;
 if target is not null then
  update messages set transport_request_id=job.client_request_id,delivery_error=case when p_ok then null else p_error end,
   media=coalesce(media,agent_media) where id=target;
  update message_transport_parts set message_id=target where job_id=p_id; perform refresh_transport_message(p_id);
 end if;
end $$;

create or replace function public.valid_agent_communication(p jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(p)='object'
 and p->'version'='1'::jsonb
 and p->>'language' in ('customer','sq','en') and p->>'tone' in ('warm','neutral','formal')
 and p->>'length' in ('concise','balanced') and p->>'questions' in ('when_needed','on_request')
 and p->>'emoji' in ('none','light')
 and (not p ? 'productPhotos' or p->>'productPhotos' in ('send','off'))
 and (p - array['version','language','tone','length','questions','emoji','productPhotos'])='{}'::jsonb, false)
$$;

revoke all on function public.attach_workflow_reply_media(uuid,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.attach_workflow_reply_media(uuid,bigint,uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
