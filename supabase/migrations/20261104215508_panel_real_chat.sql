-- Apply before the panel-chat routes. Existing external transports stay isolated.
begin;
set local lock_timeout = '5s';
alter table public.conversations add column panel_user_id uuid references auth.users(id), add column panel_stream_id uuid;
alter table public.conversations drop constraint conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check check(channel in ('instagram','whatsapp','panel'));
alter table public.conversations drop constraint conversation_channel_identity;
alter table public.conversations add constraint conversation_channel_identity check (
 (channel='instagram' and whatsapp_connection_id is null and whatsapp_participant_id is null and panel_user_id is null and panel_stream_id is null)
 or (channel='whatsapp' and instagram_connection_id is null and instagram_participant_id is null and panel_user_id is null and panel_stream_id is null)
 or (channel='panel' and instagram_connection_id is null and instagram_participant_id is null and whatsapp_connection_id is null and whatsapp_participant_id is null and panel_user_id is not null and panel_stream_id is not null));
create unique index conversation_panel_stream on public.conversations(business_id,panel_user_id,panel_stream_id) where channel='panel';
alter table public.workflow_inbound_queue drop constraint workflow_inbound_queue_channel_check;
alter table public.workflow_inbound_queue add constraint workflow_inbound_queue_channel_check check(channel in ('instagram','whatsapp','panel'));
alter table public.workflow_inbound_queue drop constraint workflow_inbound_queue_operation_kind_check;
alter table public.workflow_inbound_queue add constraint workflow_inbound_queue_operation_kind_check check(operation_kind in ('inbound','staff','test','panel'));
alter table public.workflow_inbound_queue drop constraint transport_scope;
alter table public.workflow_inbound_queue add constraint transport_scope check (
 (operation_kind='test' and channel<>'panel' and connection_id is null and conversation_id is null and operator_user_id is not null and test_stream_id is not null and client_request_id is not null and client_sequence is not null and expires_at is not null)
 or (operation_kind='panel' and channel='panel' and connection_id is null and conversation_id is not null and operator_user_id is not null and participant_id=operator_user_id::text and test_stream_id is not null and client_request_id is not null and client_sequence is not null and expires_at is not null)
 or (operation_kind in ('inbound','staff') and channel<>'panel' and connection_id is not null and test_stream_id is null));
create unique index transport_panel_sequence on public.workflow_inbound_queue(business_id,operator_user_id,test_stream_id,client_sequence) where operation_kind='panel';

create function public.can_use_panel_chat(p_business uuid,p_user uuid) returns boolean
language sql stable security invoker set search_path=public as $$
 select exists(select 1 from business_users where business_id=p_business and user_id=p_user and role='owner')
 or exists(select 1 from platform_admins where user_id=p_user);
$$;
-- Identity is checked again inside every effect transaction, not just at enqueue.
create function public.workflow_conversation_matches(c public.conversations,j public.workflow_inbound_queue) returns boolean
language sql stable security invoker set search_path=public as $$
 select c.business_id=j.business_id and c.channel=j.channel and (
  (j.operation_kind='panel' and c.channel='panel' and c.id=j.conversation_id and c.panel_user_id=j.operator_user_id
   and c.panel_stream_id=j.test_stream_id and j.participant_id=c.panel_user_id::text and j.connection_id is null
   and can_use_panel_chat(c.business_id,c.panel_user_id))
  or (j.operation_kind in ('inbound','staff') and c.channel in ('instagram','whatsapp')
   and coalesce(c.whatsapp_participant_id,c.instagram_participant_id)=j.participant_id
   and coalesce(c.whatsapp_connection_id,c.instagram_connection_id)=j.connection_id));
$$;

create or replace function public.provision_business_invitation(p_source uuid,p_user uuid,p_request text,p_input jsonb,p_token_hash text,p_token_ciphertext text,p_version uuid default null,p_node text default null,p_conversation uuid default null,p_guard jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare prior action_executions; invitation business_invitations; target uuid; eid uuid; days integer; quota integer; override business_actions; business_slug text; job workflow_inbound_queue; c conversations; current_revision integer; auto_enabled boolean;
begin
 if p_version is not null then
  select * into job from workflow_inbound_queue where id=(p_guard->>'jobId')::bigint and lease_token=(p_guard->>'leaseToken')::uuid and business_id=p_source and status='processing' and leased_until>now() for update;
  if not found then raise exception 'lease_lost'; end if;
  select * into c from conversations where id=p_conversation and business_id=p_source and workflow_conversation_matches(conversations,job) for update;
  if not found then raise exception 'invalid_conversation'; end if;
 end if;
 -- Serialize policy/allowance and retries for this source business.
 perform 1 from businesses where id=p_source for update;
 if not found or not can_execute_business_action(p_source,p_user,'business.provision',p_version is not null) then raise exception 'unauthorized'; end if;
 if p_version is not null then
  select coalesce(c.auto_reply,auto_reply,false) into auto_enabled from businesses where id=p_source;
  if c.status<>'active' or not auto_enabled then raise exception 'ownership_lost'; end if;
  select revision into current_revision from conversation_states where conversation_id=p_conversation and business_id=p_source for update;
  if current_revision is distinct from (p_guard->>'revision')::integer then raise exception 'stale_state'; end if;
 end if;
 if length(p_request) not between 1 and 250 or p_request is null or jsonb_typeof(p_input) is distinct from 'object'
 or coalesce(length(btrim(p_input->>'name')),0) not between 2 and 120
 or coalesce(p_input->>'email','')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or length(p_input->>'email')>254 or coalesce(length(p_input->>'description'),0)>2000
 or p_token_hash!~'^[0-9a-f]{64}$' then raise exception 'invalid_input'; end if;
 if p_version is not null then
  if p_conversation is null or not exists(select 1 from conversations where id=p_conversation and business_id=p_source)
   or not exists(select 1 from visual_workflow_versions v join visual_workflows w on w.business_id=v.business_id and w.enabled
    where v.id=p_version and v.business_id=p_source and exists(select 1 from jsonb_array_elements(v.graph->'nodes') n where n->>'id'=p_node and n->>'kind'='action' and n->'config'->'action'->>'actionKey'='business.provision')) then raise exception 'invalid_workflow_action'; end if;
 end if;
 select * into prior from action_executions where business_id=p_source and action_key='business.provision' and request_key=p_request;
 if found then
  if prior.input<>p_input or prior.workflow_version_id is distinct from p_version or prior.conversation_id is distinct from p_conversation then raise exception 'request_conflict'; end if;
 end if;
 if prior.id is not null and prior.status='succeeded' then
  select * into invitation from business_invitations where execution_id=prior.id;
 else
  select pa.monthly_limit into quota from business_billing b join plan_actions pa on pa.plan=b.plan and pa.action_key='business.provision' where b.business_id=p_source;
  select * into override from business_actions where business_id=p_source and action_key='business.provision' and (expires_at is null or expires_at>now());
  quota:=coalesce(override.monthly_limit,quota);
  if quota is not null and (select count(*) from action_executions where business_id=p_source and action_key='business.provision' and status='succeeded' and created_at>=date_trunc('month',now() at time zone 'Europe/Tirane') at time zone 'Europe/Tirane')>=quota then raise exception 'action_limit'; end if;
  target:=gen_random_uuid();
  business_slug:=allocate_business_slug(p_input->>'name');
  insert into businesses(id,name,slug,catalog_source,auto_reply) values(target,btrim(p_input->>'name'),business_slug,'internal',false);
  insert into action_executions(business_id,action_key,request_key,actor_id,workflow_version_id,node_id,conversation_id,input,status,result)
   values(p_source,'business.provision',p_request,p_user,p_version,p_node,p_conversation,p_input,'succeeded',jsonb_build_object('businessId',target)) on conflict(business_id,action_key,request_key) do update set status='succeeded',result=excluded.result,created_at=now() returning id into eid;
  select invitation_days into days from business_action_settings where business_id=p_source and action_key='business.provision';
  insert into business_invitations(source_business_id,target_business_id,execution_id,email,details,token_hash,token_ciphertext,expires_at)
   values(p_source,target,eid,lower(btrim(p_input->>'email')),p_input,p_token_hash,p_token_ciphertext,now()+make_interval(days=>coalesce(days,7))) returning * into invitation;
 end if;
 return jsonb_build_object('business_id',invitation.target_business_id,'token_ciphertext',invitation.token_ciphertext,'expires_at',invitation.expires_at,'status',case when invitation.status='pending' and invitation.expires_at<=now() then 'expired' else invitation.status end);
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
  and workflow_conversation_matches(conversations,job) for update;
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

create or replace function public.claim_workflow_transport(p_businesses uuid[],p_test_user uuid,p_test_stream uuid,p_fragments boolean) returns setof public.workflow_inbound_queue language plpgsql security definer set search_path=public as $$
declare candidate workflow_inbound_queue; stream text; batch record;
begin
 if p_test_user is null then
  update conversations set status='paused',auto_reply=false where id in(select conversation_id from workflow_inbound_queue where status='sending' and leased_until<now() and (p_businesses is null or business_id=any(p_businesses)));
  update workflow_inbound_queue set status='uncertain',error='Provider result requires reconciliation',leased_until=null where status='sending' and leased_until<now() and (p_businesses is null or business_id=any(p_businesses));
 end if;
 for candidate in select q.* from workflow_inbound_queue q
  where (p_businesses is null or q.business_id=any(p_businesses))
   and ((p_test_user is null and q.operation_kind in ('inbound','staff')) or (q.operation_kind='test' and q.operator_user_id=p_test_user and q.test_stream_id=p_test_stream))
   and (p_fragments is true or (not (q.payload ? 'fragmentKind')
    and not (q.operation_kind='test' and exists(select 1 from workflow_inbound_queue b
     where b.business_id=q.business_id and b.operation_kind='test' and b.operator_user_id=q.operator_user_id
      and b.test_stream_id=q.test_stream_id and b.batch_parent_id is not null))))
   and (q.status in ('queued','prepared') or q.status='processing' and q.leased_until<now())
   and (q.leased_until is null or q.leased_until<now()) and (q.expires_at is null or q.expires_at>now())    and not exists(select 1 from workflow_inbound_queue e where e.business_id=q.business_id and e.id<q.id
    and ((q.operation_kind='test' and e.operation_kind='test' and e.operator_user_id=q.operator_user_id and e.test_stream_id=q.test_stream_id)
      or (q.operation_kind<>'test' and e.connection_id=q.connection_id and e.participant_id=q.participant_id))
    and (e.status in ('queued','processing','prepared','sending','uncertain') or q.operation_kind='test' and e.status='failed'))
order by q.id limit 100 loop
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
  if p_fragments is true then
   select * into batch from workflow_fragment_window(candidate.id);
   if batch.ready_at>statement_timestamp() then continue; end if;
   if batch.payloads is not null then
    update workflow_inbound_queue set batch_payloads=batch.payloads where id=candidate.id;
    update workflow_inbound_queue set status='batched',batch_parent_id=candidate.id where id=any(batch.ids) and id<>candidate.id;
   end if;
  end if;
  return query update workflow_inbound_queue set status=case when status='prepared' then 'prepared' else 'processing' end,lease_token=gen_random_uuid(),leased_until=now()+interval '180 seconds',attempts=attempts+1 where id=candidate.id returning *;
  return;
 end loop;
end $$;

create function public.create_panel_chat(p_business uuid,p_user uuid,p_stream uuid) returns uuid
language plpgsql security invoker set search_path=public as $$
declare c conversations; customer uuid;
begin
 if not can_use_panel_chat(p_business,p_user) then raise exception 'panel_forbidden'; end if;
 if p_stream is null then raise exception 'panel_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_business::text||':'||p_user::text||':'||p_stream::text,2));
 select * into c from conversations where business_id=p_business and panel_user_id=p_user and panel_stream_id=p_stream and channel='panel';
 if found then return c.id; end if;
 insert into customers(business_id,display_name) values(p_business,'Bisedë reale nga paneli') returning id into customer;
 insert into conversations(business_id,customer_id,channel,panel_user_id,panel_stream_id,auto_reply)
 values(p_business,customer,'panel',p_user,p_stream,true) returning * into c;
 insert into conversation_states(business_id,conversation_id) values(p_business,c.id);
 return c.id;
end $$;

create function public.enqueue_panel_chat(p_business uuid,p_user uuid,p_stream uuid,p_request uuid,p_sequence integer,p_message text,p_fingerprint text) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare c conversations; job workflow_inbound_queue; latest integer;
begin
 if not can_use_panel_chat(p_business,p_user) then raise exception 'panel_forbidden'; end if;
 if p_stream is null or p_request is null or p_sequence is null or p_sequence not between 0 and 39
  or coalesce(length(btrim(p_message)),0) not between 1 and 2000 or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'panel_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_business::text||':'||p_user::text||':'||p_stream::text,2));
 select * into c from conversations where business_id=p_business and panel_user_id=p_user and panel_stream_id=p_stream and channel='panel' for update;
 if not found then raise exception 'panel_not_found'; end if;
 select * into job from workflow_inbound_queue where business_id=p_business and operator_user_id=p_user and client_request_id=p_request;
 if found then
  if job.operation_kind<>'panel' or job.conversation_id<>c.id or job.client_sequence<>p_sequence or job.request_fingerprint<>p_fingerprint then raise exception 'panel_request_conflict'; end if;
  return to_jsonb(job);
 end if;
 if c.status<>'active' or c.auto_reply is not true then raise exception 'panel_paused'; end if;
 if c.created_at<now()-interval '24 hours' then raise exception 'panel_expired'; end if;
 select max(client_sequence) into latest from workflow_inbound_queue where conversation_id=c.id and operation_kind='panel';
 if p_sequence<>coalesce(latest+1,0) then raise exception 'panel_sequence_conflict'; end if;
 insert into workflow_inbound_queue(business_id,channel,connection_id,participant_id,external_id,payload,operation_kind,operator_user_id,test_stream_id,client_request_id,client_sequence,request_fingerprint,expires_at,conversation_id)
 values(p_business,'panel',null,p_user::text,p_request::text,jsonb_build_object('message',p_message),'panel',p_user,p_stream,p_request,p_sequence,p_fingerprint,c.created_at+interval '24 hours',c.id) returning * into job;
 return to_jsonb(job);
end $$;

-- Separate claim boundary: panel jobs can never enter Meta delivery code.
create function public.claim_panel_chat(p_business uuid,p_user uuid,p_stream uuid) returns setof public.workflow_inbound_queue
language plpgsql security invoker set search_path=public as $$
declare job workflow_inbound_queue;
begin
 if not can_use_panel_chat(p_business,p_user) then raise exception 'panel_forbidden'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_business::text||':'||p_user::text||':'||p_stream::text,2)) then return; end if;
 select * into job from workflow_inbound_queue where business_id=p_business and operator_user_id=p_user and test_stream_id=p_stream
 and operation_kind='panel' and status<>'sent' order by client_sequence limit 1 for update;
 if not found or job.status not in ('queued','processing') or job.leased_until>now() then return; end if;
 if job.attempts>=3 or job.expires_at<=now() then
  update workflow_inbound_queue set status='failed',leased_until=null,error='Kërkesa nuk u përfundua. Kontrollo Rrjedhën.' where id=job.id;
  return;
 end if;
 return query update workflow_inbound_queue set status='processing',lease_token=gen_random_uuid(),leased_until=now()+interval '180 seconds',attempts=attempts+1 where id=job.id returning *;
end $$;

-- State, readable transcript and browser receipt commit atomically. No provider send.
create function public.finish_panel_chat(p_id bigint,p_token uuid,p_revision integer,p_state jsonb,p_workflow uuid,p_reply text,p_response text,p_result text,p_handoff boolean)
returns void language plpgsql security invoker set search_path=public as $$
declare job workflow_inbound_queue; c conversations; current_revision integer;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token and operation_kind='panel' and status='processing' and leased_until>now() for update;
 if not found then raise exception 'lease_lost'; end if;
 select * into c from conversations where id=job.conversation_id and workflow_conversation_matches(conversations,job) for update;
 if not found or c.status<>'active' or c.auto_reply is not true then raise exception 'ownership_lost'; end if;
 select revision into current_revision from conversation_states where conversation_id=c.id and business_id=c.business_id for update;
 if current_revision is distinct from p_revision then raise exception 'stale_state'; end if;
 if p_workflow is not null and not exists(select 1 from workflows where id=p_workflow and business_id=c.business_id) then raise exception 'invalid_workflow'; end if;
 if p_result is null or p_reply is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'panel_invalid_result'; end if;
 update conversation_states set collected=p_state,workflow_id=p_workflow,step_key=p_state->>'step_key',status=case when p_state->>'step_key'='order_ready' then 'ready' else 'in_progress' end,revision=revision+1,updated_at=now() where conversation_id=c.id;
 insert into messages(business_id,conversation_id,direction,source,body,delivery_status)
 values(c.business_id,c.id,'inbound','customer',job.payload->>'message',null),(c.business_id,c.id,'outbound','agent',p_reply,'sent');
 update conversations set last_message_at=now(),last_inbound_at=now(),last_message_preview=left(p_reply,180),openai_previous_response_id=p_response,
 status=case when p_handoff then 'paused' else status end,auto_reply=not p_handoff,updated_at=now() where id=c.id;
 update workflow_inbound_queue set status='sent',reply=p_reply,result_ciphertext=p_result,leased_until=null,error=null where id=job.id;
end $$;

-- Service-only entry points: the authenticated HTTP adapter supplies the actor.
revoke all on function public.can_use_panel_chat(uuid,uuid),public.workflow_conversation_matches(public.conversations,public.workflow_inbound_queue),public.create_panel_chat(uuid,uuid,uuid),public.enqueue_panel_chat(uuid,uuid,uuid,uuid,integer,text,text),public.claim_panel_chat(uuid,uuid,uuid),public.finish_panel_chat(bigint,uuid,integer,jsonb,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.can_use_panel_chat(uuid,uuid),public.workflow_conversation_matches(public.conversations,public.workflow_inbound_queue),public.create_panel_chat(uuid,uuid,uuid),public.enqueue_panel_chat(uuid,uuid,uuid,uuid,integer,text,text),public.claim_panel_chat(uuid,uuid,uuid),public.finish_panel_chat(bigint,uuid,integer,jsonb,uuid,text,text,text,boolean) to service_role;
commit;
