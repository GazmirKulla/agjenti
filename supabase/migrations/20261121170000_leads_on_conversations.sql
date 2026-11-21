-- A lead is a state of the conversation, not a record of its own: one open lead per conversation
-- was already the rule, almost none had a customer, and none carried a note. The status moves to
-- conversations; the customer agent sets interest from its structured reading of the message
-- (no phrase lists), an order or booking marks it won and a staff reply marks it contacted.
-- Step A (this file) is additive: the old leads table stays until the code reading it is gone,
-- then 20261121171000_drop_leads_table.sql removes it.
begin;

alter table public.conversations add column if not exists lead_status text
  check (lead_status in ('new','contacted','won','lost'));
alter table public.conversations add column if not exists lead_interest text not null default ''
  check (char_length(lead_interest) <= 500);
alter table public.conversations add column if not exists lead_at timestamptz;
alter table public.conversations add column if not exists lead_status_changed_at timestamptz;
create index if not exists conversations_lead on public.conversations(business_id, lead_status, lead_at desc)
  where lead_status is not null;

-- Each conversation takes its open lead, else its latest one.
update public.conversations c set lead_status = l.status, lead_interest = l.interest, lead_at = l.last_interest_at,
  lead_status_changed_at = l.status_changed_at
 from (select distinct on (conversation_id) conversation_id, status, interest, last_interest_at, status_changed_at
        from public.leads where conversation_id is not null
        order by conversation_id, (status in ('new','contacted')) desc, updated_at desc) l
 where l.conversation_id = c.id and c.lead_status is null;

-- The phrase-list detection goes; a staff reply still marks a new lead contacted.
drop trigger if exists track_lead_from_message on public.messages;
drop function if exists public.track_lead_from_message();
drop function if exists public.lead_rule_match(jsonb, text);

create or replace function public.lead_contacted_on_staff_reply()
returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if new.direction = 'outbound' and new.source = 'staff' then
  update conversations set lead_status = 'contacted', lead_status_changed_at = now()
   where id = new.conversation_id and business_id = new.business_id and lead_status = 'new';
 end if;
 return new;
exception when others then
 raise warning 'lead contact failed: %', sqlerrm;
 return new;
end $$;
drop trigger if exists lead_contacted_on_staff_reply on public.messages;
create trigger lead_contacted_on_staff_reply after insert on public.messages
 for each row execute function public.lead_contacted_on_staff_reply();

-- A real purchase marks the conversation's open lead won (same matching as before).
create or replace function public.win_lead_on_purchase()
returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
declare customer uuid; conversation uuid; contact text; digits text;
begin
 if tg_table_name = 'orders' and new.status not in ('confirmed','submitted','pending_reconciliation') then return new; end if;
 if tg_table_name = 'bookings' and new.status = 'cancelled' then return new; end if;
 if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
 begin
  if tg_table_name = 'orders' then
   conversation := new.conversation_id;
   customer := new.customer_id;
  else
   contact := lower(ltrim(btrim(coalesce(new.customer_contact,'')), '@'));
   digits := regexp_replace(contact, '\D', '', 'g');
   select id into customer from customers c where c.business_id = new.business_id and (
     (char_length(digits) >= 8 and regexp_replace(coalesce(c.phone,''), '\D', '', 'g') = digits)
     or (c.username is not null and contact = lower(c.username))) limit 1;
   select id into conversation from conversations v where v.business_id = new.business_id and contact <> '' and (
     lower(v.participant_username) = contact
     or (char_length(digits) >= 8 and regexp_replace(coalesce(v.whatsapp_participant_id,''), '\D', '', 'g') like '%' || right(digits, 8)))
    order by v.last_message_at desc nulls last limit 1;
  end if;
  update conversations set lead_status = 'won', lead_status_changed_at = now()
   where business_id = new.business_id and lead_status in ('new','contacted')
     and ((conversation is not null and id = conversation) or (customer is not null and customer_id = customer));
 exception when others then
  raise warning 'lead win failed: %', sqlerrm;
 end;
 return new;
end $$;

-- The customer agent records interest it read in the message (server-validated quote).
-- As before: an open lead (new, contacted) is refreshed; otherwise (none, won, lost) a new one opens.
create or replace function public.note_conversation_interest(p_business uuid, p_conversation uuid, p_interest text)
returns void language plpgsql security definer set search_path=public, pg_temp as $$
begin
 update conversations set
   lead_status = case when lead_status in ('new','contacted') then lead_status else 'new' end,
   lead_status_changed_at = case when lead_status in ('new','contacted') then lead_status_changed_at else now() end,
   lead_interest = left(btrim(coalesce(p_interest,'')), 500),
   lead_at = now()
  where id = p_conversation and business_id = p_business
    and not (customer_id is not null and exists(select 1 from customers where id = conversations.customer_id and archived_at is not null));
end $$;

-- Any member of the business (or a platform admin) moves the conversation's lead along.
create or replace function public.set_conversation_lead(p_business uuid, p_user uuid, p_conversation uuid, p_status text)
returns void language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if not exists(select 1 from business_users where business_id = p_business and user_id = p_user)
  and not exists(select 1 from platform_admins where user_id = p_user) then raise exception 'unauthorized'; end if;
 if p_status not in ('new','contacted','won','lost') then raise exception 'invalid_status'; end if;
 update conversations set lead_status = p_status,
   lead_status_changed_at = case when lead_status is not distinct from p_status then lead_status_changed_at else now() end,
   lead_at = coalesce(lead_at, now())
  where id = p_conversation and business_id = p_business;
 if not found then raise exception 'not_found'; end if;
end $$;

-- Inbox chips read the conversation's own status (before, only leads with a customer showed).
create or replace function public.inbox_row_signals(p_business uuid, p_conversations uuid[])
 returns table(conversation_id uuid, last_customer_at timestamptz, last_reply_at timestamptz, has_phone boolean, has_email boolean, order_count integer, lead_status text, customer_linked boolean)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select
    c.id,
    inbound.at,
    reply.at,
    coalesce(nullif(btrim(cu.phone), '') is not null, false)
      or coalesce(p.profile -> 'phone' ->> 'validated' = 'true', false)
      or exists (
        select 1 from messages m
        cross join lateral regexp_matches(coalesce(m.body, ''), '\+?\d[\d\s().-]{7,}\d', 'g') as found(parts)
        where m.conversation_id = c.id and m.business_id = p_business
          and m.direction = 'inbound' and m.source = 'customer'
          and length(regexp_replace(found.parts[1], '\D', '', 'g')) >= 9),
    coalesce(p.profile -> 'email' ->> 'validated' = 'true', false)
      or exists (
        select 1 from messages m
        where m.conversation_id = c.id and m.business_id = p_business
          and m.direction = 'inbound' and m.source = 'customer'
          and m.body ~ '[[:alnum:]_.+-]+@[[:alnum:]_-]+(\.[[:alnum:]_-]+)+'),
    (select count(*)::integer from orders o
      where o.business_id = p_business and o.status not in ('draft', 'failed')
        and (o.conversation_id = c.id or (cu.id is not null and o.customer_id = cu.id))),
    c.lead_status,
    cu.id is not null and cu.archived_at is null
  from conversations c
  left join customers cu on cu.id = c.customer_id and cu.business_id = p_business
  left join conversation_profiles p
    on p.business_id = p_business and p.channel = c.channel
   and p.participant_id = case c.channel when 'whatsapp' then c.whatsapp_participant_id else c.instagram_participant_id end
  left join lateral (
    select m.created_at as at from messages m
    where m.conversation_id = c.id and m.business_id = p_business
      and m.direction = 'inbound' and m.source = 'customer'
    order by m.created_at desc limit 1
  ) inbound on true
  left join lateral (
    select m.created_at as at from messages m
    where m.conversation_id = c.id and m.business_id = p_business
      and m.direction = 'outbound' and m.source in ('agent', 'staff')
      and (m.delivery_status is null or m.delivery_status in ('sent', 'delivered', 'read', 'uncertain'))
    order by m.created_at desc limit 1
  ) reply on true
  where c.business_id = p_business and c.id = any(p_conversations)
$function$;

-- Campaign audience filter by lead status reads the conversation.
create or replace function public.marketing_eligible(p_business uuid, p_conversation uuid, p_hours integer, p_orders text, p_lead text)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
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
 if p_lead is not null and c.lead_status is distinct from p_lead then return 'lead_filter'; end if;
 return null;
end $function$;

revoke all on function public.lead_contacted_on_staff_reply(), public.note_conversation_interest(uuid,uuid,text),
 public.set_conversation_lead(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.note_conversation_interest(uuid,uuid,text), public.set_conversation_lead(uuid,uuid,uuid,text) to service_role;

commit;
