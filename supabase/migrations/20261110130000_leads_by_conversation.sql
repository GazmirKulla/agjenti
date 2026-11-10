-- Most conversations have no CRM customer yet (customers are created on a
-- confirmed order or by staff), so a lead belongs to the conversation; the
-- customer is linked when there is one.
begin;

alter table public.leads alter column customer_id drop not null;
alter table public.leads drop constraint if exists leads_conversation_id_fkey;
alter table public.leads add constraint leads_conversation_id_fkey
 foreign key (conversation_id) references public.conversations(id) on delete cascade;
alter table public.leads drop constraint if exists leads_has_subject;
alter table public.leads add constraint leads_has_subject check (conversation_id is not null or customer_id is not null);

drop index if exists public.leads_one_open;
create unique index leads_one_open on public.leads(business_id, conversation_id)
 where status in ('new','contacted') and conversation_id is not null;

create or replace function public.track_lead_from_message()
returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
declare conv conversations; matched text; settings jsonb;
begin
 begin
  select * into conv from conversations where id = new.conversation_id;
  if conv.id is null or conv.channel not in ('instagram','whatsapp') then return new; end if;
  if new.direction = 'outbound' and new.source = 'staff' then
   update leads set status = 'contacted', status_changed_at = now(), updated_at = now()
    where business_id = new.business_id and conversation_id = conv.id and status = 'new'
      and coalesce((select (lead_settings->>'autoContacted')::boolean from businesses where id = new.business_id), true);
   return new;
  end if;
  if new.direction <> 'inbound' or new.source <> 'customer' then return new; end if;
  if conv.customer_id is not null and exists(select 1 from customers where id = conv.customer_id and archived_at is not null) then return new; end if;
  select lead_settings into settings from businesses where id = new.business_id;
  matched := lead_rule_match(coalesce(settings,'{}'::jsonb), new.body);
  if matched is null then return new; end if;
  insert into leads(business_id, customer_id, conversation_id, source, interest, last_interest_at)
   values(new.business_id, conv.customer_id, conv.id, matched, left(btrim(new.body), 500), new.created_at)
   on conflict (business_id, conversation_id) where status in ('new','contacted') and conversation_id is not null
   do update set last_interest_at = excluded.last_interest_at, interest = excluded.interest,
     customer_id = coalesce(excluded.customer_id, leads.customer_id), updated_at = now();
 exception when others then
  raise warning 'lead tracking failed: %', sqlerrm;
 end;
 return new;
end $$;

create or replace function public.win_lead_on_purchase()
returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
declare customer uuid; conversation uuid; contact text; digits text;
begin
 -- Only a real purchase counts: not a draft or failed order, not a cancelled booking.
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
  update leads set status = 'won', status_changed_at = now(), updated_at = now()
   where business_id = new.business_id and status in ('new','contacted')
     and ((conversation is not null and conversation_id = conversation) or (customer is not null and customer_id = customer));
 exception when others then
  raise warning 'lead win failed: %', sqlerrm;
 end;
 return new;
end $$;

drop trigger if exists win_lead_on_order on public.orders;
create trigger win_lead_on_order after insert or update of status on public.orders
 for each row execute function public.win_lead_on_purchase();
drop trigger if exists win_lead_on_booking on public.bookings;
create trigger win_lead_on_booking after insert or update of status on public.bookings
 for each row execute function public.win_lead_on_purchase();

create or replace function public.manage_lead(p_business uuid, p_user uuid, p_lead uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if not exists(select 1 from business_users where business_id = p_business and user_id = p_user)
  and not exists(select 1 from platform_admins where user_id = p_user) then raise exception 'unauthorized'; end if;
 if p_status not in ('new','contacted','won','lost') then raise exception 'invalid_status'; end if;
 if p_status in ('new','contacted') and exists(select 1 from leads l join leads o on o.business_id = l.business_id
   and o.conversation_id = l.conversation_id and o.id <> l.id and o.status in ('new','contacted') where l.id = p_lead) then
  raise exception 'lead_open_exists'; end if;
 update leads set status = p_status, status_changed_at = case when status = p_status then status_changed_at else now() end,
   status_changed_by = p_user, note = coalesce(left(p_note, 2000), note), updated_at = now()
  where id = p_lead and business_id = p_business;
 if not found then raise exception 'not_found'; end if;
end $$;

commit;
