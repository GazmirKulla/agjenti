-- Leads: customers who showed interest but have not bought or booked yet.
-- A lead is created from the customer's own message by simple rules the owner
-- can adjust (businesses.lead_settings); it becomes "won" by itself when that
-- customer orders or books, and "contacted" when staff replies.
begin;

create table if not exists public.leads (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 customer_id uuid not null references public.customers(id) on delete cascade,
 conversation_id uuid references public.conversations(id) on delete set null,
 status text not null default 'new' check (status in ('new','contacted','won','lost')),
 source text not null check (source in ('price','availability','contact','keyword','agent','manual')),
 interest text not null default '' check (char_length(interest) <= 500),
 note text not null default '' check (char_length(note) <= 2000),
 last_interest_at timestamptz not null default now(),
 status_changed_at timestamptz,
 status_changed_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
-- One open lead per customer; new interest refreshes it.
create unique index if not exists leads_one_open on public.leads(business_id, customer_id) where status in ('new','contacted');
create index if not exists leads_business_recent on public.leads(business_id, status, last_interest_at desc);
alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
grant select on public.leads to authenticated;
grant all on public.leads to service_role;
drop policy if exists "tenant select leads" on public.leads;
create policy "tenant select leads" on public.leads for select to authenticated using (is_business_member(business_id));

alter table public.businesses add column if not exists lead_settings jsonb not null default '{}'::jsonb;

-- Which rule (if any) a customer's message matches. Settings default to on.
create or replace function public.lead_rule_match(p_settings jsonb, p_body text)
returns text language plpgsql immutable set search_path=public, pg_temp as $$
declare body text := translate(lower(coalesce(p_body,'')), 'çë', 'ce'); word text;
begin
 if coalesce((p_settings->>'enabled')::boolean, true) is false or body = '' then return null; end if;
 if coalesce((p_settings->>'price')::boolean, true)
   and body ~ '(sa kushto|sa eshte cmimi|cmim|ofert|sa leke|sa lek|how much|price|preventiv)' then return 'price'; end if;
 if coalesce((p_settings->>'availability')::boolean, true)
   and body ~ '(a keni|e keni|keni ne gjendje|ne stok|disponueshm|ka vend|ka termin|kur mund te vij|a punoni|available|in stock)' then return 'availability'; end if;
 if coalesce((p_settings->>'contact')::boolean, true)
   and (body ~ '(me telefono|me merr ne telefon|me kontakto|me shkruani ne|call me|contact me)'
        or body ~ '\+?\d[\d\s-]{7,}\d' or body ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}') then return 'contact'; end if;
 if jsonb_typeof(p_settings->'keywords') = 'array' then
  for word in select translate(lower(btrim(value)), 'çë', 'ce') from jsonb_array_elements_text(p_settings->'keywords') loop
   if char_length(word) >= 2 and position(word in body) > 0 then return 'keyword'; end if;
  end loop;
 end if;
 return null;
end $$;

-- Customer messages create or refresh a lead; staff replies mark it contacted.
create or replace function public.track_lead_from_message()
returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
declare conv conversations; matched text; settings jsonb;
begin
 begin
  select * into conv from conversations where id = new.conversation_id;
  if conv.customer_id is null or conv.channel = 'panel' then return new; end if;
  if new.direction = 'outbound' and new.source = 'staff' then
   update leads set status = 'contacted', status_changed_at = now(), updated_at = now()
    where business_id = new.business_id and customer_id = conv.customer_id and status = 'new'
      and coalesce((select (lead_settings->>'autoContacted')::boolean from businesses where id = new.business_id), true);
   return new;
  end if;
  if new.direction <> 'inbound' or new.source <> 'customer' then return new; end if;
  if exists(select 1 from customers where id = conv.customer_id and archived_at is not null) then return new; end if;
  select lead_settings into settings from businesses where id = new.business_id;
  matched := lead_rule_match(coalesce(settings,'{}'::jsonb), new.body);
  if matched is null then return new; end if;
  insert into leads(business_id, customer_id, conversation_id, source, interest, last_interest_at)
   values(new.business_id, conv.customer_id, new.conversation_id, matched, left(btrim(new.body), 500), new.created_at)
   on conflict (business_id, customer_id) where status in ('new','contacted')
   do update set last_interest_at = excluded.last_interest_at, interest = excluded.interest,
     conversation_id = excluded.conversation_id, updated_at = now();
 exception when others then
  raise warning 'lead tracking failed: %', sqlerrm;
 end;
 return new;
end $$;
drop trigger if exists track_lead_from_message on public.messages;
create trigger track_lead_from_message after insert on public.messages
 for each row execute function public.track_lead_from_message();

-- An order or booking closes that customer's open lead as won.
create or replace function public.win_lead_on_purchase()
returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
declare customer uuid; digits text;
begin
 begin
  if tg_table_name = 'orders' then
   customer := coalesce(new.customer_id, (select customer_id from conversations where id = new.conversation_id));
  else
   digits := regexp_replace(coalesce(new.customer_contact,''), '\D', '', 'g');
   select id into customer from customers c where c.business_id = new.business_id and (
     (char_length(digits) >= 8 and regexp_replace(coalesce(c.phone,''), '\D', '', 'g') = digits)
     or (c.username is not null and lower(ltrim(btrim(coalesce(new.customer_contact,'')), '@')) = lower(c.username)))
    limit 1;
  end if;
  if customer is not null then
   update leads set status = 'won', status_changed_at = now(), updated_at = now()
    where business_id = new.business_id and customer_id = customer and status in ('new','contacted');
  end if;
 exception when others then
  raise warning 'lead win failed: %', sqlerrm;
 end;
 return new;
end $$;
drop trigger if exists win_lead_on_order on public.orders;
create trigger win_lead_on_order after insert on public.orders for each row execute function public.win_lead_on_purchase();
drop trigger if exists win_lead_on_booking on public.bookings;
create trigger win_lead_on_booking after insert on public.bookings for each row execute function public.win_lead_on_purchase();

-- Any member of the business (or a platform admin) moves a lead along.
create or replace function public.manage_lead(p_business uuid, p_user uuid, p_lead uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if not exists(select 1 from business_users where business_id = p_business and user_id = p_user)
  and not exists(select 1 from platform_admins where user_id = p_user) then raise exception 'unauthorized'; end if;
 if p_status not in ('new','contacted','won','lost') then raise exception 'invalid_status'; end if;
 -- Reopening is refused when the customer already has another open lead.
 if p_status in ('new','contacted') and exists(select 1 from leads l join leads o on o.business_id = l.business_id
   and o.customer_id = l.customer_id and o.id <> l.id and o.status in ('new','contacted') where l.id = p_lead) then
  raise exception 'lead_open_exists'; end if;
 update leads set status = p_status, status_changed_at = case when status = p_status then status_changed_at else now() end,
   status_changed_by = p_user, note = coalesce(left(p_note, 2000), note), updated_at = now()
  where id = p_lead and business_id = p_business;
 if not found then raise exception 'not_found'; end if;
end $$;

-- Only the owner or a platform admin changes the rules.
create or replace function public.save_lead_settings(p_business uuid, p_user uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if not exists(select 1 from business_users where business_id = p_business and user_id = p_user and role = 'owner')
  and not exists(select 1 from platform_admins where user_id = p_user) then raise exception 'unauthorized'; end if;
 if jsonb_typeof(p_settings) <> 'object' or octet_length(p_settings::text) > 8192 then raise exception 'invalid_settings'; end if;
 update businesses set lead_settings = p_settings, updated_at = now() where id = p_business;
end $$;

revoke all on function public.manage_lead(uuid,uuid,uuid,text,text), public.save_lead_settings(uuid,uuid,jsonb),
 public.track_lead_from_message(), public.win_lead_on_purchase() from public, anon, authenticated;
grant execute on function public.manage_lead(uuid,uuid,uuid,text,text), public.save_lead_settings(uuid,uuid,jsonb) to service_role;

commit;
