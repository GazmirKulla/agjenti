-- Deployment: apply this migration BEFORE deploying the new inbound/Inbox code.
-- Keep marketing_control.enabled=false until the isolated live-channel smoke test.
-- Enable only the chosen test business via its owner settings before that test.
-- Operational rollback: disable marketing_control; keep tables/receipts and allowance
-- columns so uncertain sends remain fenced and account reservations remain intact.
begin;
-- Disabled until the operator enables it after migration and channel smoke tests.
create table public.marketing_control (singleton boolean primary key default true check(singleton), enabled boolean not null default false);
insert into public.marketing_control default values;
create table public.marketing_settings (
 business_id uuid primary key references businesses(id) on delete cascade,
 enabled boolean not null default false, timezone text not null default 'Europe/Tirane',
 frequency_days integer not null default 7 check(frequency_days between 1 and 365),
 start_hour integer not null default 9 check(start_hour between 0 and 23),
 end_hour integer not null default 21 check(end_hour between 1 and 24), check(start_hour<end_hour)
);
create table public.marketing_preferences (
 business_id uuid not null references businesses(id) on delete cascade,
 connection_id uuid not null references messaging_connections(id) on delete cascade,
 participant_id text not null, status text not null default 'unknown' check(status in ('unknown','subscribed','unsubscribed')),
 pending_message_id uuid references messages(id) on delete set null, reviewed_message_id uuid references messages(id) on delete set null,
 review_pending boolean not null default false, evidence text, updated_at timestamptz not null default now(),
 primary key(connection_id,participant_id)
);
create table public.marketing_preference_events (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 connection_id uuid not null references messaging_connections(id) on delete cascade, participant_id text not null,
 message_id uuid references messages(id) on delete set null, user_id uuid references profiles(id) on delete set null,
 decision text not null check(decision in ('subscribe','unsubscribe','unchanged','ambiguous','unavailable','manual_unsubscribe')),
 evidence text, reference_message_id uuid references messages(id) on delete set null,
 confirmation_status text not null default 'none' check(confirmation_status in ('none','pending','sending','sent','failed','uncertain')),
 confirmation_message_id uuid references messages(id) on delete set null, confirmation_token uuid, confirmation_started_at timestamptz,
 created_at timestamptz not null default now(), unique(message_id)
);
create table public.marketing_campaigns (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 created_by uuid not null references profiles(id), confirmed_by uuid references profiles(id),
 name text not null check(length(name) between 1 and 120), channel text not null check(channel in ('instagram','whatsapp')),
 body text not null check(length(body) between 1 and 1000), terms text not null default '' check(length(terms)<=1000),
 offer_expires_at timestamptz, hours integer not null check(hours between 1 and 23),
 orders_filter text not null default 'all' check(orders_filter in ('all','with','without','30','90')),
 lead_filter text check(lead_filter in ('new','contacted','won','lost')),
 is_test boolean not null default false, status text not null default 'draft' check(status in ('draft','running','paused','cancelled','completed')),
 reason text, excluded jsonb not null default '{}', created_at timestamptz not null default now(), confirmed_at timestamptz,
 expires_at timestamptz not null default (now()+interval '23 hours'), next_send_at timestamptz,
 unique(id,business_id)
);
create table public.marketing_campaign_recipients (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null, business_id uuid not null references businesses(id) on delete cascade,
 conversation_id uuid not null references conversations(id) on delete cascade,
 connection_id uuid not null references messaging_connections(id) on delete cascade, participant_id text not null,
 customer_id uuid references customers(id) on delete set null, identity_key text not null,
 name text not null, body text not null, message_id uuid references messages(id) on delete set null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain','skipped')),
 reason text, started_at timestamptz, finished_at timestamptz, token uuid,
 foreign key(campaign_id,business_id) references marketing_campaigns(id,business_id) on delete cascade,
 unique(campaign_id,identity_key), unique(campaign_id,connection_id,participant_id)
);
create index marketing_pending on marketing_campaign_recipients(campaign_id) where status='pending';
create index marketing_frequency on marketing_campaign_recipients(business_id,identity_key,started_at desc);
-- Only the verified live inbound handler supplies this provider timestamp.
-- Historical imports and business echoes cannot open a marketing window or grant consent.
alter table messages add column marketing_inbound_at timestamptz;
create function public.guard_marketing_inbound() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if (new.marketing_inbound_at is not null or (TG_OP='UPDATE' and old.marketing_inbound_at is not null))
  and not pg_has_role(current_user,'service_role','usage') then raise exception 'verified_inbound_server_only'; end if;
 return new;
end $$;
create trigger guard_marketing_inbound before insert or update on messages for each row execute function guard_marketing_inbound();
create index marketing_live_inbound on messages(business_id,conversation_id,marketing_inbound_at desc) where marketing_inbound_at is not null;
alter table messages add column campaign_id uuid references marketing_campaigns(id) on delete set null;
alter table messages add column campaign_name text;
alter table messages drop constraint messages_sent_via_check;
alter table messages add constraint messages_sent_via_check check(sent_via is null or sent_via in ('instagram_app','whatsapp_app','campaign','marketing_preference'));
-- Reuse the account-wide allowance ledger; job reservations retain their unique key.
alter table message_allowance_reservations drop constraint message_allowance_reservations_pkey;
alter table message_allowance_reservations alter column job_id drop not null;
alter table message_allowance_reservations add unique(job_id);
alter table message_allowance_reservations add column campaign_recipient_id uuid unique references marketing_campaign_recipients(id) on delete cascade;
alter table message_allowance_reservations add column marketing_preference_event_id uuid unique references marketing_preference_events(id) on delete cascade;
alter table message_allowance_reservations add check(num_nonnulls(job_id,campaign_recipient_id,marketing_preference_event_id)=1);

-- A new message holds promotional sends BEFORE asynchronous interpretation.
create function public.hold_marketing_preference() returns trigger language plpgsql security definer set search_path=public as $$
declare c conversations; conn uuid; participant text;
begin
 if new.direction<>'inbound' or new.source<>'customer' or new.marketing_inbound_at is null then return new; end if;
 if not exists(select 1 from marketing_settings where business_id=new.business_id) then return new; end if;
 select * into c from conversations where id=new.conversation_id and business_id=new.business_id;
 conn:=coalesce(c.whatsapp_connection_id,c.instagram_connection_id);
 participant:=case when c.channel='whatsapp' then c.whatsapp_participant_id else c.instagram_participant_id end;
 if conn is null or participant is null then return new; end if;
 insert into marketing_preferences(business_id,connection_id,participant_id,pending_message_id,review_pending)
 values(new.business_id,conn,participant,new.id,true)
 on conflict(connection_id,participant_id) do update set pending_message_id=new.id,review_pending=true,updated_at=now();
 return new;
end $$;
create trigger hold_marketing_preference after insert on messages for each row execute function hold_marketing_preference();

-- A withdrawal suppresses other channel contacts only when CRM already proves
-- they are the same customer. Never merge people by names or inferred identity.
create function public.suppress_linked_marketing(p_business uuid,p_customer uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_customer is null then return; end if;
 update marketing_preferences p set status='unsubscribed',review_pending=false,pending_message_id=null,evidence=null,updated_at=now()
 where p.business_id=p_business and exists(select 1 from conversations c where c.business_id=p_business and c.customer_id=p_customer
 and coalesce(c.whatsapp_connection_id,c.instagram_connection_id)=p.connection_id and coalesce(c.whatsapp_participant_id,c.instagram_participant_id)=p.participant_id);
end $$;

create function public.review_marketing_preference(p_business uuid,p_message uuid,p_decision text,p_evidence text,p_reference uuid default null) returns boolean
language plpgsql security definer set search_path=public as $$
declare m messages; c conversations; pref marketing_preferences; conn uuid; participant text;
begin
 if p_decision not in ('subscribe','unsubscribe','unchanged','ambiguous','unavailable') then raise exception 'invalid_decision'; end if;
 select * into m from messages where id=p_message and business_id=p_business and direction='inbound' and source='customer' and marketing_inbound_at is not null;
 if not found then raise exception 'invalid_message'; end if;
 if p_reference is not null and not exists(select 1 from messages where id=p_reference and business_id=p_business and conversation_id=m.conversation_id and direction='outbound' and delivery_status in ('sent','delivered','read') and created_at<=m.created_at) then raise exception 'invalid_reference'; end if;
 select * into c from conversations where id=m.conversation_id and business_id=p_business;
 conn:=coalesce(c.whatsapp_connection_id,c.instagram_connection_id);
 participant:=case when c.channel='whatsapp' then c.whatsapp_participant_id else c.instagram_participant_id end;
 if p_decision in ('subscribe','unsubscribe') and (nullif(p_evidence,'') is null or position(p_evidence in coalesce(m.body,''))=0) then raise exception 'invalid_evidence'; end if;
 insert into marketing_preferences(business_id,connection_id,participant_id,pending_message_id,review_pending)
 values(p_business,conn,participant,p_message,true) on conflict do nothing;
 select * into pref from marketing_preferences where connection_id=conn and participant_id=participant for update;
 if pref.pending_message_id is distinct from p_message or not pref.review_pending then
  -- A delayed withdrawal may still suppress marketing. It cannot silently lose
  -- to a later unrelated inbound message; stale opt-ins never grant permission.
  if p_decision<>'unsubscribe' or exists(select 1 from marketing_preference_events where message_id=p_message and decision='unsubscribe') then return false; end if;
  update marketing_preferences set status='unsubscribed',updated_at=now() where connection_id=conn and participant_id=participant;
  insert into marketing_preference_events(business_id,connection_id,participant_id,message_id,decision,evidence,reference_message_id,confirmation_status)
  values(p_business,conn,participant,p_message,'unsubscribe',p_evidence,p_reference,case when pref.status<>'unsubscribed' then 'pending' else 'none' end)
  on conflict(message_id) do update set decision='unsubscribe',evidence=excluded.evidence;
  perform suppress_linked_marketing(p_business,c.customer_id);
  return true;
 end if;
 -- An earlier unresolved message cannot be silently cleared by an unrelated reply.
 if p_decision='unchanged' and exists(select 1 from marketing_preference_events where connection_id=conn and participant_id=participant and decision in ('ambiguous','unavailable') and created_at>coalesce((select max(created_at) from marketing_preference_events where connection_id=conn and participant_id=participant and decision in ('subscribe','unsubscribe','manual_unsubscribe')),'epoch')) then p_decision:='ambiguous'; end if;
 insert into marketing_preference_events(business_id,connection_id,participant_id,message_id,decision,evidence,reference_message_id,confirmation_status)
 values(p_business,conn,participant,p_message,p_decision,p_evidence,p_reference,case when p_decision='unsubscribe' and pref.status<>'unsubscribed' then 'pending' else 'none' end)
 on conflict(message_id) do update set decision=excluded.decision,evidence=excluded.evidence,reference_message_id=excluded.reference_message_id,confirmation_status=case when marketing_preference_events.confirmation_status='none' then excluded.confirmation_status else marketing_preference_events.confirmation_status end;
 update marketing_preferences set status=case p_decision when 'subscribe' then 'subscribed' when 'unsubscribe' then 'unsubscribed' else status end,
 review_pending=p_decision in ('ambiguous','unavailable'), reviewed_message_id=p_message,evidence=p_evidence,updated_at=now()
 where connection_id=conn and participant_id=participant;
 if p_decision='unsubscribe' then perform suppress_linked_marketing(p_business,c.customer_id); end if;
 return true;
end $$;

create function public.marketing_eligible(p_business uuid,p_conversation uuid,p_hours integer,p_orders text,p_lead text) returns text
language plpgsql security definer set search_path=public as $$
declare c conversations; pref marketing_preferences; conn uuid; participant text; identity text; days integer;
begin
 select * into c from conversations where id=p_conversation and business_id=p_business;
 if not found then return 'missing'; end if;
 conn:=coalesce(c.whatsapp_connection_id,c.instagram_connection_id);
 participant:=case when c.channel='whatsapp' then c.whatsapp_participant_id else c.instagram_participant_id end;
 if conn is null or participant is null or not (exists(select 1 from instagram_connections where id=conn and business_id=p_business and status='connected') or exists(select 1 from whatsapp_connections where id=conn and business_id=p_business and status='connected')) then return 'disconnected'; end if;
 if c.last_inbound_at is null or c.last_inbound_at<clock_timestamp()-make_interval(hours=>least(p_hours,23)) or c.last_inbound_at>clock_timestamp() then return 'window_closed'; end if;
 if not exists(select 1 from messages where conversation_id=c.id and business_id=p_business and direction='inbound' and source='customer' and external_message_id is not null and marketing_inbound_at>=clock_timestamp()-make_interval(hours=>least(p_hours,23)) and marketing_inbound_at<=clock_timestamp()) then return 'no_inbound'; end if;
 if c.customer_id is not null and exists(select 1 from customers where id=c.customer_id and (business_id<>p_business or archived_at is not null)) then return 'archived'; end if;
 select * into pref from marketing_preferences where business_id=p_business and connection_id=conn and participant_id=participant;
 if not found then return 'no_consent'; end if;
 if pref.status='unsubscribed' then return 'unsubscribed'; end if;
 if pref.review_pending then return 'review_pending'; end if;
 if pref.status<>'subscribed' then return 'no_consent'; end if;
 identity:=coalesce(c.customer_id::text,conn::text||':'||participant);
 select frequency_days into days from marketing_settings where business_id=p_business;
 if exists(select 1 from marketing_campaign_recipients r where r.business_id=p_business
 and (r.identity_key=identity or r.connection_id=conn and r.participant_id=participant)
 and r.status in ('sending','sent','uncertain') and r.started_at>now()-make_interval(days=>coalesce(days,7))) then return 'frequency'; end if;
 if p_orders='with' and not exists(select 1 from orders o where o.business_id=p_business and (o.conversation_id=c.id or o.customer_id=c.customer_id)) then return 'orders_filter'; end if;
 if p_orders='without' and exists(select 1 from orders o where o.business_id=p_business and (o.conversation_id=c.id or o.customer_id=c.customer_id)) then return 'orders_filter'; end if;
 if p_orders in ('30','90') and not exists(select 1 from orders o where o.business_id=p_business and (o.conversation_id=c.id or o.customer_id=c.customer_id) and o.created_at>now()-make_interval(days=>p_orders::integer)) then return 'orders_filter'; end if;
 if p_lead is not null and not exists(select 1 from leads where business_id=p_business and conversation_id=c.id and status=p_lead) then return 'lead_filter'; end if;
 return null;
end $$;

create function public.prepare_marketing_campaign(p_business uuid,p_user uuid,p_input jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare campaign marketing_campaigns; c conversations; person text; rendered text; identity text; bizname text; total integer:=0; max_recipients integer; why text; exclusions jsonb:='{}';
begin
 if not exists(select 1 from business_users where business_id=p_business and user_id=p_user) then raise exception 'forbidden'; end if;
 if not exists(select 1 from marketing_settings where business_id=p_business and enabled) then raise exception 'disabled'; end if;
 max_recipients:=(p_input->>'maxRecipients')::integer;
 if p_input->>'testConversationId' is not null then
  if not exists(select 1 from business_users where business_id=p_business and user_id=p_user and role='owner') then raise exception 'owner_required'; end if;
  if not exists(select 1 from conversations where id=(p_input->>'testConversationId')::uuid and business_id=p_business and channel=p_input->>'channel') then raise exception 'invalid_input'; end if;
  max_recipients:=1;
 end if;
 if max_recipients is null or max_recipients not between 1 and 500 then raise exception 'recipient_limit'; end if;
 insert into marketing_campaigns(business_id,created_by,name,channel,body,terms,offer_expires_at,hours,orders_filter,lead_filter,is_test)
 values(p_business,p_user,p_input->>'name',p_input->>'channel',p_input->>'body',coalesce(p_input->>'terms',''),nullif(p_input->>'offerExpiresAt','')::timestamptz,(p_input->>'hours')::integer,p_input->>'orders',nullif(p_input->>'lead',''),p_input->>'testConversationId' is not null) returning * into campaign;
 if campaign.offer_expires_at is not null and campaign.offer_expires_at<=now() then raise exception 'offer_expired'; end if;
 select name into bizname from businesses where id=p_business;
 for c in select * from conversations where business_id=p_business and channel=campaign.channel and (p_input->>'testConversationId' is null or id=(p_input->>'testConversationId')::uuid) and last_inbound_at>=now()-interval '23 hours' order by last_inbound_at desc,id loop
  why:=marketing_eligible(p_business,c.id,campaign.hours,campaign.orders_filter,campaign.lead_filter);
  if why is null and total>=max_recipients then why:='recipient_limit'; end if;
  if why is not null then exclusions:=jsonb_set(exclusions,array[why],to_jsonb(coalesce((exclusions->>why)::integer,0)+1)); continue; end if;
  person:=coalesce(nullif(c.participant_display_name,''),nullif(c.participant_username,''),'klient');
  identity:=coalesce(c.customer_id::text,coalesce(c.whatsapp_connection_id,c.instagram_connection_id)::text||':'||coalesce(c.whatsapp_participant_id,c.instagram_participant_id));
  rendered:=replace(replace(campaign.body,'{{emri}}',person),'{{biznesi}}',bizname)
   ||case when campaign.terms<>'' then E'\n\n'||replace(replace(campaign.terms,'{{emri}}',person),'{{biznesi}}',bizname) else '' end||E'\n\nShkruaj STOP që të mos marrësh më oferta.';
  if (campaign.channel='instagram' and octet_length(rendered)>1000) or (campaign.channel='whatsapp' and length(rendered)>4096) then raise exception 'rendered_message_too_long'; end if;
  insert into marketing_campaign_recipients(campaign_id,business_id,conversation_id,connection_id,participant_id,customer_id,identity_key,name,body)
  values(campaign.id,p_business,c.id,coalesce(c.whatsapp_connection_id,c.instagram_connection_id),coalesce(c.whatsapp_participant_id,c.instagram_participant_id),c.customer_id,identity,person,rendered) on conflict do nothing;
  if found then total:=total+1; else exclusions:=jsonb_set(exclusions,array['duplicate'],to_jsonb(coalesce((exclusions->>'duplicate')::integer,0)+1)); end if;
 end loop;
 update marketing_campaigns set excluded=exclusions where id=campaign.id;
 return campaign.id;
end $$;

create function public.manage_marketing(p_business uuid,p_user uuid,p_action text,p_id uuid default null,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare c marketing_campaigns; conv conversations; conn uuid; participant text; tz text; n integer;
begin
 if not exists(select 1 from business_users where business_id=p_business and user_id=p_user and role='owner') then raise exception 'owner_required'; end if;
 if p_action='settings' then
  tz:=p_input->>'timezone';
  if not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'invalid_timezone'; end if;
  insert into marketing_settings(business_id,enabled,timezone,frequency_days)
  values(p_business,(p_input->>'enabled')::boolean,tz,(p_input->>'frequencyDays')::integer)
  on conflict(business_id) do update set enabled=excluded.enabled,timezone=excluded.timezone,frequency_days=excluded.frequency_days;
  return '{}'::jsonb;
 end if;
 if p_action='unsubscribe' then
  select * into conv from conversations where id=p_id and business_id=p_business;
  if not found then raise exception 'not_found'; end if;
  conn:=coalesce(conv.whatsapp_connection_id,conv.instagram_connection_id); participant:=coalesce(conv.whatsapp_participant_id,conv.instagram_participant_id);
  insert into marketing_preferences(business_id,connection_id,participant_id,status) values(p_business,conn,participant,'unsubscribed')
  on conflict(connection_id,participant_id) do update set status='unsubscribed',review_pending=false,pending_message_id=null,updated_at=now();
  insert into marketing_preference_events(business_id,connection_id,participant_id,user_id,decision) values(p_business,conn,participant,p_user,'manual_unsubscribe');
  perform suppress_linked_marketing(p_business,conv.customer_id);
  return '{}'::jsonb;
 end if;
 select * into c from marketing_campaigns where id=p_id and business_id=p_business for update;
 if not found then raise exception 'not_found'; end if;
 if p_action='confirm' then
  if c.status='running' then return jsonb_build_object('status',c.status); end if;
  if c.status<>'draft' or c.created_at<now()-interval '15 minutes' then raise exception 'preview_expired'; end if;
  select count(*) into n from marketing_campaign_recipients where campaign_id=c.id;
  if n=0 or n is distinct from (p_input->>'count')::integer then raise exception 'audience_changed'; end if;
  if not (select enabled from marketing_control where singleton) then raise exception 'globally_disabled'; end if;
  if not exists(select 1 from marketing_settings where business_id=p_business and enabled) then raise exception 'disabled'; end if;
  update marketing_campaigns set status='running',confirmed_by=p_user,confirmed_at=now() where id=c.id;
 elsif p_action='pause' and c.status='running' then update marketing_campaigns set status='paused',reason='owner_paused' where id=c.id;
 elsif p_action='resume' and c.status='paused' and c.expires_at>now() then update marketing_campaigns set status='running',reason=null where id=c.id;
 elsif p_action='cancel' and c.status in ('draft','running','paused') then
  update marketing_campaigns set status='cancelled',reason='owner_cancelled' where id=c.id;
  update marketing_campaign_recipients set status='skipped',reason='cancelled',finished_at=now() where campaign_id=c.id and status='pending';
 else raise exception 'invalid_transition'; end if;
 return jsonb_build_object('id',c.id);
end $$;

create function public.begin_marketing_send(p_recipient uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r marketing_campaign_recipients; c marketing_campaigns; s marketing_settings; a jsonb; skip_reason text; msg uuid; h integer; identity text;
begin
 select * into r from marketing_campaign_recipients where id=p_recipient;
 if not found then return null; end if;
 -- One business-wide rate/frequency boundary, including competing campaigns.
 perform pg_advisory_xact_lock(hashtextextended(r.business_id::text,431));
 select * into c from marketing_campaigns where id=r.campaign_id for update;
 select * into r from marketing_campaign_recipients where id=p_recipient for update;
 if r.status<>'pending' or c.status<>'running' or c.confirmed_by is null then return null; end if;
 if not exists(select 1 from marketing_control where singleton and enabled) then
  update marketing_campaigns set status='paused',reason='globally_disabled' where id=c.id; return null;
 end if;
 select * into s from marketing_settings where business_id=c.business_id;
 if not found or not s.enabled or not exists(select 1 from business_users where business_id=c.business_id and user_id=c.confirmed_by and role='owner') then
  update marketing_campaigns set status='paused',reason='authorization_changed' where id=c.id; return null;
 end if;
 if exists(select 1 from marketing_campaigns where business_id=c.business_id and next_send_at>clock_timestamp()) then return null; end if;
 h:=extract(hour from clock_timestamp() at time zone s.timezone);
 if c.expires_at<=now() then skip_reason:='campaign_expired';
 elsif c.offer_expires_at<=now() then skip_reason:='offer_expired';
 elsif h<s.start_hour or h>=s.end_hour then skip_reason:='quiet_hours';
 else
  perform 1 from marketing_preferences where connection_id=r.connection_id and participant_id=r.participant_id for update;
  skip_reason:=marketing_eligible(c.business_id,r.conversation_id,c.hours,c.orders_filter,c.lead_filter);
 end if;
 if skip_reason is not null then
  update marketing_campaign_recipients set status='skipped',reason=skip_reason,finished_at=now() where id=r.id; return null;
 end if;
 -- Protect the frozen recipient against a conversation relink or identity change.
 if not exists(select 1 from conversations where id=r.conversation_id and business_id=r.business_id and channel=c.channel
  and coalesce(whatsapp_connection_id,instagram_connection_id)=r.connection_id and coalesce(whatsapp_participant_id,instagram_participant_id)=r.participant_id
  and customer_id is not distinct from r.customer_id) then
  update marketing_campaign_recipients set status='skipped',reason='identity_changed',finished_at=now() where id=r.id; return null;
 end if;
 -- Normal inbound replies take precedence.
 if exists(select 1 from workflow_inbound_queue where business_id=c.business_id and status in ('queued','processing','prepared','sending')) then return null; end if;
 a:=business_allowance(c.business_id);
 if (a->>'available')::bigint<=0 then update marketing_campaigns set status='paused',reason='quota' where id=c.id; return null; end if;
 insert into message_allowance_reservations(campaign_recipient_id,business_id,period_start,bucket)
 values(r.id,c.business_id,(a->>'periodStart')::timestamptz,case when (a->>'used')::bigint+(a->>'reserved')::bigint<(a->>'limit')::bigint then 'monthly' else 'extra' end);
 insert into messages(business_id,conversation_id,direction,source,body,delivery_status,sent_via,campaign_id,campaign_name,instagram_connection_id,whatsapp_connection_id)
 values(r.business_id,r.conversation_id,'outbound','staff',r.body,'sending','campaign',c.id,c.name,
 case when c.channel='instagram' then r.connection_id end,case when c.channel='whatsapp' then r.connection_id end) returning id into msg;
 update marketing_campaigns set next_send_at=clock_timestamp()+interval '1 second' where id=c.id;
 update marketing_campaign_recipients set status='sending',started_at=now(),token=gen_random_uuid(),message_id=msg where id=r.id returning * into r;
 return to_jsonb(r)||jsonb_build_object('channel',c.channel);
end $$;

create function public.finish_marketing_send(p_recipient uuid,p_token uuid,p_status text,p_external text default null,p_reason text default null) returns void
language plpgsql security definer set search_path=public as $$
declare r marketing_campaign_recipients; a message_allowance_reservations; receipt message_transport_receipts; delivery text; attempted integer; failures integer;
begin
 if p_status not in ('sent','failed','uncertain') or p_status='sent' and nullif(p_external,'') is null then raise exception 'invalid_receipt'; end if;
 -- Same lock order as begin/cancel; a receipt is allowed after cancellation.
 perform 1 from marketing_campaigns where id=(select campaign_id from marketing_campaign_recipients where id=p_recipient) for update;
 select * into r from marketing_campaign_recipients where id=p_recipient and token=p_token for update;
 if not found then raise exception 'invalid_token'; end if;
 if r.status in ('sent','failed') then return; end if;
 if r.status not in ('sending','uncertain') then raise exception 'invalid_state'; end if;
 select * into a from message_allowance_reservations where campaign_recipient_id=r.id;
 if not found then raise exception 'missing_allowance'; end if;
 perform lock_allowance_payer(r.business_id);
 delivery:=p_status;
 if p_external is not null then
  perform pg_advisory_xact_lock(hashtextextended(r.connection_id::text||':'||p_external,1));
  select * into receipt from message_transport_receipts where connection_id=r.connection_id and participant_id=r.participant_id and external_message_id=p_external;
  if found and transport_status_rank(receipt.status)>transport_status_rank(delivery) then delivery:=receipt.status; end if;
 end if;
 if a.status='reserved' and p_status='sent' then perform count_allowance_use(a.business_id,a.period_start,a.bucket); end if;
 update message_allowance_reservations set status=case p_status when 'sent' then 'sent' when 'failed' then 'released' else 'reserved' end where campaign_recipient_id=r.id;
 update marketing_campaign_recipients set status=p_status,reason=p_reason,finished_at=now() where id=r.id;
 update messages set delivery_status=delivery,external_message_id=p_external,delivery_error=p_reason where id=r.message_id and business_id=r.business_id;
 if p_status='sent' then update conversations set last_message_at=now(),last_message_preview=left(r.body,200) where id=r.conversation_id and business_id=r.business_id; end if;
 select count(*),count(*) filter(where status in ('failed','uncertain')) into attempted,failures from marketing_campaign_recipients where campaign_id=r.campaign_id and status in ('sent','failed','uncertain');
 if p_reason in ('token_revoked','rate_limited') or p_status='uncertain' or (attempted>=10 and failures::numeric/attempted>.2) then
  update marketing_campaigns set status='paused',reason=case when p_reason in ('token_revoked','rate_limited') then p_reason when p_status='uncertain' then 'uncertain' else 'failure_rate' end where id=r.campaign_id and status='running';
 end if;
end $$;

create function public.recover_marketing_campaigns() returns void language plpgsql security definer set search_path=public as $$
declare r marketing_campaign_recipients; e marketing_preference_events;
begin
 for e in select * from marketing_preference_events where confirmation_status='sending' and confirmation_started_at<now()-interval '2 minutes' loop
  perform finish_marketing_confirmation(e.id,e.confirmation_token,'uncertain',null);
 end loop;
 for r in select * from marketing_campaign_recipients where status='sending' and started_at<now()-interval '2 minutes' loop
  perform finish_marketing_send(r.id,r.token,'uncertain',null,'worker_interrupted');
 end loop;
 update marketing_campaigns c set status='completed' where status='running' and not exists(select 1 from marketing_campaign_recipients where campaign_id=c.id and status in ('pending','sending'));
end $$;

-- Existing receipt path also updates campaign messages, including early receipts.
create function public.apply_marketing_receipt() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update messages m set delivery_status=new.status from marketing_campaign_recipients r
 where r.message_id=m.id and r.business_id=new.business_id and r.connection_id=new.connection_id and r.participant_id=new.participant_id
 and m.external_message_id=new.external_message_id and transport_status_rank(new.status)>transport_status_rank(m.delivery_status);
 update messages m set delivery_status=new.status from marketing_preference_events e
 where e.confirmation_message_id=m.id and e.business_id=new.business_id and e.connection_id=new.connection_id and e.participant_id=new.participant_id
 and m.external_message_id=new.external_message_id and transport_status_rank(new.status)>transport_status_rank(m.delivery_status);
 return new;
end $$;
create trigger apply_marketing_receipt after insert or update on message_transport_receipts for each row execute function apply_marketing_receipt();

-- An unsubscribe acknowledgement is a customer-requested service message, never a campaign.
create function public.begin_marketing_confirmation(p_event uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare e marketing_preference_events; c conversations; a jsonb; msg uuid; txt text:='U çregjistrove nga ofertat. Mund të vazhdosh të na shkruash për porosi ose ndihmë.';
begin
 select * into e from marketing_preference_events where id=p_event and decision='unsubscribe' for update;
 if not found or e.confirmation_status<>'pending' then return null; end if;
 if not exists(select 1 from marketing_control where singleton and enabled) then return null; end if;
 select c0.* into c from conversations c0 join messages m on m.conversation_id=c0.id where m.id=e.message_id and c0.business_id=e.business_id;
 if not found or c.last_inbound_at is null or c.last_inbound_at<clock_timestamp()-interval '23 hours' or c.last_inbound_at>clock_timestamp()
  or coalesce(c.whatsapp_connection_id,c.instagram_connection_id) is distinct from e.connection_id
  or coalesce(c.whatsapp_participant_id,c.instagram_participant_id) is distinct from e.participant_id then
  update marketing_preference_events set confirmation_status='failed' where id=e.id; return null;
 end if;
 if not exists(select 1 from messages where conversation_id=c.id and business_id=e.business_id and direction='inbound' and source='customer' and marketing_inbound_at>=clock_timestamp()-interval '23 hours' and marketing_inbound_at<=clock_timestamp()) then return null; end if;
 if not (exists(select 1 from instagram_connections where id=e.connection_id and business_id=e.business_id and status='connected') or exists(select 1 from whatsapp_connections where id=e.connection_id and business_id=e.business_id and status='connected')) then return null; end if;
 if not exists(select 1 from marketing_preferences where connection_id=e.connection_id and participant_id=e.participant_id and status='unsubscribed') then
  update marketing_preference_events set confirmation_status='failed' where id=e.id; return null;
 end if;
 a:=business_allowance(e.business_id);
 if (a->>'available')::bigint<=0 then return null; end if;
 insert into message_allowance_reservations(marketing_preference_event_id,business_id,period_start,bucket)
 values(e.id,e.business_id,(a->>'periodStart')::timestamptz,case when (a->>'used')::bigint+(a->>'reserved')::bigint<(a->>'limit')::bigint then 'monthly' else 'extra' end);
 insert into messages(business_id,conversation_id,direction,source,body,delivery_status,sent_via,instagram_connection_id,whatsapp_connection_id)
 values(e.business_id,c.id,'outbound','staff',txt,'sending','marketing_preference',c.instagram_connection_id,c.whatsapp_connection_id) returning id into msg;
 update marketing_preference_events set confirmation_status='sending',confirmation_message_id=msg,confirmation_token=gen_random_uuid(),confirmation_started_at=now() where id=e.id returning * into e;
 return to_jsonb(e)||jsonb_build_object('body',txt,'channel',c.channel);
end $$;
create function public.finish_marketing_confirmation(p_event uuid,p_token uuid,p_status text,p_external text default null) returns void language plpgsql security definer set search_path=public as $$
declare e marketing_preference_events; a message_allowance_reservations; receipt message_transport_receipts; delivery text;
begin
 if p_status not in ('sent','failed','uncertain') or p_status='sent' and nullif(p_external,'') is null then raise exception 'invalid_receipt'; end if;
 select * into e from marketing_preference_events where id=p_event and confirmation_token=p_token for update;
 if not found then raise exception 'invalid_token'; end if;
 if e.confirmation_status in ('sent','failed') then return; end if;
 if e.confirmation_status not in ('sending','uncertain') then raise exception 'invalid_state'; end if;
 select * into a from message_allowance_reservations where marketing_preference_event_id=e.id;
 if not found then raise exception 'missing_allowance'; end if;
 perform lock_allowance_payer(e.business_id);
 if p_status='sent' and a.status='reserved' then perform count_allowance_use(e.business_id,a.period_start,a.bucket); end if;
 update message_allowance_reservations set status=case p_status when 'sent' then 'sent' when 'failed' then 'released' else 'reserved' end where marketing_preference_event_id=e.id;
 update marketing_preference_events set confirmation_status=p_status where id=e.id;
 delivery:=p_status;
 if p_external is not null then
  perform pg_advisory_xact_lock(hashtextextended(e.connection_id::text||':'||p_external,1));
  select * into receipt from message_transport_receipts where connection_id=e.connection_id and participant_id=e.participant_id and external_message_id=p_external;
  if found and transport_status_rank(receipt.status)>transport_status_rank(delivery) then delivery:=receipt.status; end if;
 end if;
 update messages set delivery_status=delivery,external_message_id=p_external where id=e.confirmation_message_id and business_id=e.business_id;
end $$;

-- All tables are server-only; membership/owner checks are at every manual RPC boundary.
do $$ declare t text; f record; begin
 foreach t in array array['marketing_control','marketing_settings','marketing_preferences','marketing_preference_events','marketing_campaigns','marketing_campaign_recipients'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
 ('suppress_linked_marketing','guard_marketing_inbound','hold_marketing_preference','review_marketing_preference','marketing_eligible','prepare_marketing_campaign','manage_marketing','begin_marketing_send','finish_marketing_send','recover_marketing_campaigns','apply_marketing_receipt','begin_marketing_confirmation','finish_marketing_confirmation') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
