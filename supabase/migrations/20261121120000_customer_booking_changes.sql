-- Customer bookings, phase 2: the customer agent tells a customer about their own bookings, cancels one
-- or moves it to another free time, always after the customer's confirmation.
--
-- * bookings.conversation_id is now set for every booking the agent makes (it was set only for bookings
--   staff record from a conversation), so a customer's bookings are found by their channel identity.
-- * valid_visual_graph accepts the new process step "booking_manage" (version 2 only; it waits for the customer).
-- * change_workflow_booking: the only way the agent cancels or moves a booking. Like save_workflow_booking it
--   checks the job lease, the conversation, the process revision and the reviewed action in the checkpoint;
--   then that the booking belongs to this customer. The calendar rules stay in save_calendar_booking.
-- * workflow_booking_changes: one row per agent change (replay returns the same booking, never a second change).
-- * booking_customer_messages: what the server told the customer about a booking, once, inside the 24-hour window.
--
-- Rollback: drop change_workflow_booking, workflow_booking_changes and booking_customer_messages; restore the previous
-- valid_visual_graph (20261013121000) and save_workflow_booking (20261106140000). The column can stay.
begin;
set local lock_timeout='5s';

update public.bookings b set conversation_id=e.conversation_id from public.workflow_booking_effects e
 where e.booking_id=b.id and e.business_id=b.business_id and b.conversation_id is null;

create table if not exists public.workflow_booking_changes (
 business_id uuid not null references public.businesses(id) on delete cascade,
 request_key text not null check(length(request_key)<=200),
 job_id bigint references public.workflow_inbound_queue(id) on delete set null,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 action text not null check(action in ('cancel','reschedule')),
 previous_starts_at timestamptz not null,
 created_at timestamptz not null default now(),
 primary key(business_id,request_key)
);
alter table public.workflow_booking_changes enable row level security;
revoke all on public.workflow_booking_changes from anon,authenticated;
grant all on public.workflow_booking_changes to service_role;

-- Messages the server sends the customer about their booking (a staff decision, the reminder on the day).
-- Sent only inside the 24-hour messaging window; one row per message, so nothing is sent twice.
create table if not exists public.booking_customer_messages (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 kind text not null check(kind in ('reminder','confirmed','cancelled','moved')),
 dedupe_key text not null check(length(dedupe_key)<=200),
 connection_id uuid, participant_id text,
 status text not null default 'sending' check(status in ('sending','sent','failed','skipped')),
 reason text, external_message_id text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(business_id,dedupe_key)
);
create index if not exists booking_customer_messages_sending on public.booking_customer_messages(connection_id,participant_id) where status='sending';
alter table public.booking_customer_messages enable row level security;
revoke all on public.booking_customer_messages from anon,authenticated;
grant all on public.booking_customer_messages to service_role;

create or replace function public.valid_visual_graph(p jsonb,p_publish boolean) returns boolean
language plpgsql immutable set search_path=public as $$
declare n jsonb; e jsonb; c jsonb; f jsonb; member text; members text[]:=array[]::text[]; flow_ids text[]:=array[]::text[]; k text; port text; reached integer; binding_key text; binding jsonb; binding_id uuid; product_ids uuid[]:=array[]::uuid[]; service_ids uuid[]:=array[]::uuid[];
begin
 if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'version') is distinct from 'number' or coalesce(p->>'version','') not in ('1','2')
  or jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 120
  or jsonb_typeof(p->'nodes') is distinct from 'array' or jsonb_typeof(p->'edges') is distinct from 'array' or octet_length(p::text)>100000 then return false; end if;
 if jsonb_array_length(p->'nodes') not between 1 and 32 or jsonb_array_length(p->'edges')>64 then return false; end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p->'nodes') x)<>jsonb_array_length(p->'nodes')
  or (select count(distinct x->>'id') from jsonb_array_elements(p->'edges') x)<>jsonb_array_length(p->'edges') then return false; end if;
 for n in select * from jsonb_array_elements(p->'nodes') loop
  k:=n->>'kind'; c:=n->'config';
  if jsonb_typeof(n->'id') is distinct from 'string' or coalesce(n->>'id','')!~'^[a-zA-Z0-9_-]{1,80}$' or n->>'id' in ('__proto__','prototype','constructor')
   or k is null or k not in ('action','start','condition','knowledge','collect','confirm','product','booking','booking_manage','order_status','handoff','end')
   or jsonb_typeof(n->'label') is distinct from 'string' or length(n->>'label')>100
   or jsonb_typeof(c) is distinct from 'object'
   or jsonb_typeof(n->'position'->'x') is distinct from 'number' or jsonb_typeof(n->'position'->'y') is distinct from 'number' then return false; end if;
  if k in ('action','booking','booking_manage','order_status') and p->>'version'<>'2' then return false; end if;
  if k='action' then
   if c?'action' then
    if jsonb_typeof(c->'action') is distinct from 'object' or c->'action'->>'actionKey' is distinct from 'business.provision'
     or jsonb_typeof(c->'action'->'actionVersion') is distinct from 'number' or c->'action'->>'actionVersion' is distinct from '1' or jsonb_typeof(c->'action'->'inputs') is distinct from 'object' then return false; end if;
    if exists(select 1 from jsonb_each(c->'action'->'inputs') x where x.key not in ('name','email','description') or jsonb_typeof(x.value) is distinct from 'string' or (x.value#>>'{}')!~'^[a-zA-Z][a-zA-Z0-9_]{0,59}$' or (x.value#>>'{}') in ('constructor','prototype','__proto__')) then return false; end if;
   end if;
   if p_publish and (not(c?'action') or not(c->'action'->'inputs'?'name') or not(c->'action'->'inputs'?'email')) then return false; end if;
  end if;
  if abs((n->'position'->>'x')::numeric)>5000 or abs((n->'position'->>'y')::numeric)>5000 then return false; end if;
  if (c?'prompt' and (jsonb_typeof(c->'prompt')<>'string' or length(c->>'prompt')>1500))
   or (c?'fieldKey' and (jsonb_typeof(c->'fieldKey')<>'string' or length(c->>'fieldKey')>60 or c->>'fieldKey' in ('__proto__','prototype','constructor')))
   or (c?'value' and (jsonb_typeof(c->'value')<>'string' or length(c->>'value')>300))
   or (c?'fieldType' and coalesce(c->>'fieldType','') not in ('text','email','phone','number','photo'))
   or (c?'condition' and coalesce(c->>'condition','') not in ('intent_order','intent_support','intent_booking','field_present','field_equals')) then return false; end if;
  if c->>'condition'='intent_booking' and p->>'version'<>'2' then return false; end if;
  if p_publish then
   if length(btrim(n->>'label'))=0 then return false; end if;
   if k in ('collect','confirm') and length(btrim(coalesce(c->>'prompt','')))=0 then return false; end if;
   if (k='collect' or (k='condition' and c->>'condition' in ('field_present','field_equals'))) and coalesce(c->>'fieldKey','')!~'^[a-zA-Z][a-zA-Z0-9_]{0,59}$' then return false; end if;
   if k='condition' and coalesce(c->>'condition','') not in ('intent_order','intent_support','intent_booking','field_present','field_equals') then return false; end if;
   if k='condition' and c->>'condition'='field_equals' and length(btrim(coalesce(c->>'value','')))=0 then return false; end if;
   if k='start' and exists(select 1 from jsonb_array_elements(p->'edges') x where x->>'target'=n->>'id') then return false; end if;
   foreach port in array case when k in ('action','condition','confirm') then array['yes','no'] when k in ('handoff','end') then array[]::text[] else array['next'] end loop
    if (select count(*) from jsonb_array_elements(p->'edges') x where x->>'source'=n->>'id' and x->>'port'=port)<>1 then return false; end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(p->'edges') x where x->>'source'=n->>'id' and
    case when k in ('action','condition','confirm') then x->>'port' not in ('yes','no') when k in ('end','handoff') then true else x->>'port'<>'next' end) then return false; end if;
  end if;
 end loop;
 for e in select * from jsonb_array_elements(p->'edges') loop
  if jsonb_typeof(e->'id') is distinct from 'string' or coalesce(e->>'id','')!~'^[a-zA-Z0-9_-]{1,80}$' or coalesce(e->>'port','') not in ('next','yes','no')
   or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'id'=e->>'source')
   or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'id'=e->>'target') then return false; end if;
 end loop;
 if p->>'version'='2' then
  if jsonb_typeof(p->'flows') is distinct from 'array' or jsonb_array_length(p->'flows')>16 then return false; end if;
  if p_publish and jsonb_array_length(p->'flows')=0 then return false; end if;
  for f in select * from jsonb_array_elements(p->'flows') loop
   if jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(f->'id') is distinct from 'string' or coalesce(f->>'id','')!~'^[a-zA-Z0-9_-]{1,80}$'
    or f->>'id' in ('__proto__','prototype','constructor') or f->>'id'=any(flow_ids)
    or jsonb_typeof(f->'label') is distinct from 'string' or length(f->>'label')>100
    or coalesce(f->>'kind','') not in ('order','booking','information','support','custom')
    or jsonb_typeof(f->'nodeIds') is distinct from 'array' or jsonb_array_length(f->'nodeIds') not between 1 and 32
    or jsonb_typeof(f->'entryNodeId') is distinct from 'string'
    or not exists(select 1 from jsonb_array_elements(f->'nodeIds') x where x=to_jsonb(f->>'entryNodeId'))
    or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'id'=f->>'entryNodeId' and x->>'kind' not in ('start','end')) then return false; end if;
   if p_publish and length(btrim(f->>'label'))=0 then return false; end if;
   flow_ids:=array_append(flow_ids,f->>'id');
   foreach binding_key in array array['productIds','serviceIds'] loop
    if f?binding_key then
     if jsonb_typeof(f->binding_key) is distinct from 'array' or jsonb_array_length(f->binding_key)>200 then return false; end if;
     for binding in select * from jsonb_array_elements(f->binding_key) loop
      if jsonb_typeof(binding) is distinct from 'string' or (binding#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
      binding_id:=(binding#>>'{}')::uuid;
      if binding_key='productIds' then
       if binding_id=any(product_ids) then return false; end if;
       product_ids:=array_append(product_ids,binding_id);
      else
       if binding_id=any(service_ids) then return false; end if;
       service_ids:=array_append(service_ids,binding_id);
      end if;
     end loop;
    end if;
   end loop;
   for c in select * from jsonb_array_elements(f->'nodeIds') loop
    if jsonb_typeof(c) is distinct from 'string' then return false; end if;
    member:=c#>>'{}';
    if member=any(members) or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'id'=member) then return false; end if;
    members:=array_append(members,member);
   end loop;
  end loop;
 end if;
 if p_publish then
  if (select count(*) from jsonb_array_elements(p->'nodes') x where x->>'kind'='start')<>1
   or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'kind' in ('end','handoff')) then return false; end if;
  with recursive reachable(id) as (
   select x->>'id' from jsonb_array_elements(p->'nodes') x where x->>'kind'='start' or (p->>'version'='2' and exists(select 1 from jsonb_array_elements(p->'flows') flow_entry where flow_entry->>'entryNodeId'=x->>'id'))
   union select edge_item->>'target' from reachable r,jsonb_array_elements(p->'edges') edge_item where edge_item->>'source'=r.id
  ) select count(*) into reached from reachable;
  if reached<>jsonb_array_length(p->'nodes') then return false; end if;
  -- Transitive closure with UNION is bounded by 32*32 pairs, even for hostile graphs.
  if exists(with recursive instant(a,b) as (
   select edge_item->>'source',edge_item->>'target' from jsonb_array_elements(p->'edges') edge_item
    join jsonb_array_elements(p->'nodes') s on s->>'id'=edge_item->>'source'
    join jsonb_array_elements(p->'nodes') t on t->>'id'=edge_item->>'target'
    where s->>'kind' not in ('collect','confirm','product','booking','booking_manage') and t->>'kind' not in ('collect','confirm','product','booking','booking_manage')
   union select x.a,y.b from instant x join (select edge_item->>'source' a,edge_item->>'target' b from jsonb_array_elements(p->'edges') edge_item
    join jsonb_array_elements(p->'nodes') s on s->>'id'=edge_item->>'source'
    join jsonb_array_elements(p->'nodes') t on t->>'id'=edge_item->>'target'
    where s->>'kind' not in ('collect','confirm','product','booking','booking_manage') and t->>'kind' not in ('collect','confirm','product','booking','booking_manage')) y on x.b=y.a
  ) select 1 from instant where a=b) then return false; end if;
 end if;
 return true;
end $$;


create or replace function public.save_workflow_booking(
 p_job bigint,p_token uuid,p_conversation uuid,p_revision integer,
 p_service uuid,p_name text,p_contact text,p_start timestamptz,
 p_status text,p_notes text,p_request_key text
) returns public.bookings language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue; c conversations; b bookings; current_revision integer; enabled boolean; checkpoint jsonb; selected_instance jsonb; selected_action jsonb; terms jsonb; service_row booking_services; settings_row business_calendar_settings;
begin
 select * into job from workflow_inbound_queue where id=p_job and lease_token=p_token
  and status='processing' and leased_until>now() for update;
 if not found then raise exception 'lease_lost'; end if;
 select * into c from conversations where id=p_conversation and business_id=job.business_id
  and workflow_conversation_matches(conversations,job) for update;
 if not found then raise exception 'invalid_conversation'; end if;
 select coalesce(c.auto_reply,auto_reply,false) into enabled from businesses where id=job.business_id for update;
 if c.status<>'active' or not enabled then raise exception 'ownership_lost'; end if;
 select revision,collected into current_revision,checkpoint from conversation_states where conversation_id=p_conversation and business_id=job.business_id for update;
 if current_revision is distinct from p_revision then raise exception 'stale_state'; end if;
 if p_request_key is null or p_request_key not like 'ig:'||p_conversation::text||':%' or length(p_request_key)>200
  or p_status not in ('pending','confirmed') then raise exception 'invalid_booking_effect'; end if;
 select booked.* into b from workflow_booking_effects e join bookings booked on booked.id=e.booking_id
  where e.job_id=p_job and e.business_id=job.business_id and e.conversation_id=p_conversation and e.request_key=p_request_key;
 if found then return b; end if;
 -- The process checkpoint is the authority for reviewed inputs, never the model or caller.
 if checkpoint->>'schemaVersion'='4' then
  select item.value,item.value->'action' into selected_instance,selected_action
   from jsonb_each(checkpoint->'instances') item
   where item.value->'action'->>'tool'='booking.create'
    and p_request_key='ig:'||p_conversation::text||':'||(item.value->'action'->>'id');
  if selected_action is null or selected_action->>'status' is distinct from 'running'
   or selected_action->>'toolVersion' is distinct from '1'
   or coalesce((selected_action->'approval'->>'expiresAt')::numeric,0)<=extract(epoch from clock_timestamp())*1000
   or checkpoint->>'mode' is distinct from 'live'
   or checkpoint->>'businessId' is distinct from job.business_id::text
   or checkpoint->>'conversationId' is distinct from p_conversation::text
   then raise exception 'invalid_booking_effect'; end if;
  -- Recheck mutable collection policy under the business lock held above.
  if exists(select 1 from businesses owner cross join lateral jsonb_array_elements(coalesce(owner.agent_collection_policy->'scopes','[]'::jsonb)) scope
    where owner.id=job.business_id and scope->>'versionId'=selected_instance->>'versionId' and scope->>'mode'='collection_only')
    then raise exception 'collection_effect_denied'; end if;
  terms:=selected_action->'input';
  select * into service_row from booking_services where business_id=job.business_id and id=p_service for share;
  if not found or not service_row.is_active or not service_row.booking_enabled then raise exception 'service_unavailable'; end if;
  select * into settings_row from business_calendar_settings where business_id=job.business_id for share;
  if not found or not settings_row.agent_booking_enabled then raise exception 'agent_booking_disabled'; end if;
  if jsonb_build_object('serviceId',service_row.id,'serviceName',service_row.name,
    'durationMinutes',service_row.duration_minutes,'bufferMinutes',service_row.buffer_minutes,
    'timezone',settings_row.timezone,'confirmationMode',settings_row.confirmation_mode)
   is distinct from jsonb_build_object('serviceId',terms->'serviceId','serviceName',terms->'serviceName',
    'durationMinutes',terms->'durationMinutes','bufferMinutes',terms->'bufferMinutes',
    'timezone',terms->'timezone','confirmationMode',terms->'confirmationMode')
   then raise exception 'booking_terms_changed'; end if;
  if p_name is distinct from terms->>'name' or p_contact is distinct from terms->>'contact'
   or p_notes is distinct from ''
   or p_start is distinct from (((terms->>'date')||' '||(terms->>'time'))::timestamp at time zone settings_row.timezone)
   or p_status is distinct from (case when settings_row.confirmation_mode='automatic' then 'confirmed' else 'pending' end)
   then raise exception 'invalid_booking_effect'; end if;
 end if;
 b:=save_calendar_booking(job.business_id,null,0,p_service,p_name,p_contact,p_start,p_status,p_notes,p_request_key);
 update bookings set conversation_id=p_conversation where id=b.id and business_id=job.business_id and conversation_id is null returning * into b;
 insert into workflow_booking_effects(job_id,business_id,conversation_id,request_key,booking_id)
  values(p_job,job.business_id,p_conversation,p_request_key,b.id)
  on conflict(business_id,request_key) do nothing;
 return b;
end $$;

create or replace function public.change_workflow_booking(
 p_job bigint,p_token uuid,p_conversation uuid,p_revision integer,
 p_booking uuid,p_booking_revision integer,p_action text,p_start timestamptz,p_request_key text
) returns public.bookings language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue; c conversations; b bookings; current_revision integer; enabled boolean; checkpoint jsonb;
 selected_action jsonb; input jsonb; settings_row business_calendar_settings; next_status text; previous timestamptz;
begin
 select * into job from workflow_inbound_queue where id=p_job and lease_token=p_token
  and status='processing' and leased_until>now() for update;
 if not found then raise exception 'lease_lost'; end if;
 select * into c from conversations where id=p_conversation and business_id=job.business_id
  and workflow_conversation_matches(conversations,job) for update;
 if not found then raise exception 'invalid_conversation'; end if;
 select coalesce(c.auto_reply,auto_reply,false) into enabled from businesses where id=job.business_id for update;
 if c.status<>'active' or not enabled then raise exception 'ownership_lost'; end if;
 select revision,collected into current_revision,checkpoint from conversation_states where conversation_id=p_conversation and business_id=job.business_id for update;
 if current_revision is distinct from p_revision then raise exception 'stale_state'; end if;
 if p_request_key is null or p_request_key not like 'ig:'||p_conversation::text||':%' or length(p_request_key)>200
  or p_action not in ('cancel','reschedule') or (p_action='reschedule' and p_start is null) then raise exception 'invalid_booking_effect'; end if;
 select booked.* into b from workflow_booking_changes e join bookings booked on booked.id=e.booking_id
  where e.business_id=job.business_id and e.conversation_id=p_conversation and e.request_key=p_request_key;
 if found then return b; end if;
 -- The process checkpoint is the authority for what the customer reviewed, never the caller.
 select item.value->'action' into selected_action from jsonb_each(checkpoint->'instances') item
  where item.value->'action'->>'tool'='booking.change'
   and p_request_key='ig:'||p_conversation::text||':'||(item.value->'action'->>'id');
 if checkpoint->>'schemaVersion' is distinct from '4' or selected_action is null or selected_action->>'status' is distinct from 'running'
  or selected_action->>'toolVersion' is distinct from '1'
  or coalesce((selected_action->'approval'->>'expiresAt')::numeric,0)<=extract(epoch from clock_timestamp())*1000
  or checkpoint->>'mode' is distinct from 'live'
  or checkpoint->>'businessId' is distinct from job.business_id::text
  or checkpoint->>'conversationId' is distinct from p_conversation::text then raise exception 'invalid_booking_effect'; end if;
 input:=selected_action->'input';
 if input->>'bookingId' is distinct from p_booking::text or input->>'action' is distinct from p_action
  or (input->>'bookingRevision')::numeric is distinct from p_booking_revision::numeric then raise exception 'invalid_booking_effect'; end if;
 select * into settings_row from business_calendar_settings where business_id=job.business_id for share;
 if not found or not settings_row.agent_booking_enabled then raise exception 'agent_booking_disabled'; end if;
 if p_action='reschedule' and p_start is distinct from (((input->>'date')||' '||(input->>'time'))::timestamp at time zone settings_row.timezone)
  then raise exception 'invalid_booking_effect'; end if;
 select * into b from bookings where id=p_booking and business_id=job.business_id for update;
 if not found then raise exception 'booking_not_found'; end if;
 -- Only a booking made in a conversation with this same customer (same channel identity) can be changed.
 if not exists(select 1 from conversations o where o.id=b.conversation_id and o.business_id=job.business_id and o.channel=c.channel
   and coalesce(o.whatsapp_participant_id,o.instagram_participant_id)=coalesce(c.whatsapp_participant_id,c.instagram_participant_id)
   and coalesce(o.whatsapp_connection_id,o.instagram_connection_id) is not distinct from coalesce(c.whatsapp_connection_id,c.instagram_connection_id))
  then raise exception 'booking_not_owned'; end if;
 if b.status='cancelled' then raise exception 'booking_cancelled'; end if;
 if b.starts_at<=now() then raise exception 'booking_started'; end if;
 previous:=b.starts_at;
 -- A moved booking waits for the business again when it confirms bookings by hand.
 next_status:=case when p_action='cancel' then 'cancelled' when settings_row.confirmation_mode='manual' then 'pending' else b.status end;
 b:=save_calendar_booking(job.business_id,b.id,p_booking_revision,b.service_id,b.customer_name,b.customer_contact,
  case when p_action='cancel' then b.starts_at else p_start end,next_status,b.notes,null);
 insert into workflow_booking_changes(business_id,request_key,job_id,conversation_id,booking_id,action,previous_starts_at)
  values(job.business_id,p_request_key,p_job,p_conversation,b.id,p_action,previous) on conflict do nothing;
 return b;
end $$;
revoke all on function public.change_workflow_booking(bigint,uuid,uuid,integer,uuid,integer,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.change_workflow_booking(bigint,uuid,uuid,integer,uuid,integer,text,timestamptz,text) to service_role;

notify pgrst, 'reload schema';
commit;
