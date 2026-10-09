-- A single service catalog for information and optional appointments.
alter table public.booking_services
 add column description text not null default '' check(length(description)<=8000),
 add column category text not null default '' check(length(category)<=120),
 add column price_amount numeric(12,2) check(price_amount>=0),
 add column currency text not null default 'EUR' check(currency in ('EUR','ALL','USD')),
 add column price_mode text not null default 'request' check(price_mode in ('fixed','from','request')),
 add column booking_enabled boolean not null default true,
 add column hours jsonb check(hours is null or jsonb_typeof(hours)='array'),
 add column knowledge_entry_id uuid unique references public.knowledge_entries(id),
 add column updated_at timestamptz not null default now(),
 add constraint service_price_required check(price_mode='request' or price_amount is not null);
-- Existing appointments remain bookable. New catalog services opt in explicitly.
alter table public.booking_services alter column booking_enabled set default false;

-- Preserve existing service descriptions and identifiers used by the AI knowledge context.
insert into public.booking_services(id,business_id,name,description,duration_minutes,booking_enabled,is_active,knowledge_entry_id)
 select gen_random_uuid(), business_id, left(title,120), left(body,8000), 30, false, is_active, id
 from public.knowledge_entries where intent_key='service' and length(btrim(title))>=2;

create function public.sync_service_knowledge() returns trigger language plpgsql security definer set search_path=public as $$
declare content text;
begin
 content:=new.description;
 if new.category<>'' then content:=content||E'\nKategoria: '||new.category;end if;
 content:=content||E'\nÇmimi: '||case when new.price_mode='request' then 'Sipas kërkesës' else
  case when new.price_mode='from' then 'Nga ' else '' end||new.price_amount::text||' '||new.currency end;
 if new.booking_enabled then
  content:=content||E'\nRezervim me orar: po. Kohëzgjatja: '||new.duration_minutes||' min. Pushim: '||new.buffer_minutes||' min. Disponueshmëria duhet verifikuar para konfirmimit.';
  if new.hours is not null then content:=content||E'\nOrari i shërbimit (0=e diel, zona kohore e biznesit): '||new.hours::text;end if;
 else content:=content||E'\nRezervim me orar: jo; kontakto biznesin për kërkesa.';end if;
 if new.knowledge_entry_id is null then
  insert into knowledge_entries(business_id,title,body,intent_key,is_active) values(new.business_id,new.name,content,'service',new.is_active) returning id into new.knowledge_entry_id;
 else
  update knowledge_entries set title=new.name,body=content,is_active=new.is_active,updated_at=now() where id=new.knowledge_entry_id and business_id=new.business_id;
  if not found then raise exception 'service_knowledge_not_found';end if;
 end if;
 new.updated_at:=clock_timestamp();
 return new;
end $$;
revoke all on function public.sync_service_knowledge() from public,anon,authenticated;
create trigger service_knowledge before insert or update on public.booking_services for each row execute function public.sync_service_knowledge();
update public.booking_services set name=name;

create or replace function public.save_calendar_booking(p_business uuid,p_id uuid,p_revision integer,p_service uuid,p_name text,p_contact text,p_start timestamptz,p_status text,p_notes text,p_request_key text default null)
returns public.bookings language plpgsql security definer set search_path=public as $$
declare b bookings; s booking_services; cfg business_calendar_settings; finish timestamptz; blocked timestamptz; local_start timestamp; local_end timestamp; connection google_calendar_connections;
begin
 -- Serialize calendar mutations and re-check hours under the same business lock.
 perform 1 from businesses where id=p_business for update;
 if not found then raise exception 'business_not_found';end if;
 if p_request_key is not null then
  select * into b from bookings where business_id=p_business and request_key=p_request_key;
  if found then return b;end if;
 end if;
 if p_id is not null then
  select * into b from bookings where id=p_id and business_id=p_business for update;
  if not found then raise exception 'booking_not_found';end if;
  if b.revision<>p_revision then raise exception 'stale_booking';end if;
  if b.sync_lease_until>now() then raise exception 'sync_in_progress';end if;
  if b.status='cancelled' then raise exception 'booking_cancelled';end if;
 end if;
 if p_status not in ('pending','confirmed','cancelled') or (p_id is null and p_status='cancelled') then raise exception 'invalid_status';end if;
 select * into s from booking_services where id=p_service and business_id=p_business;
 if not found or ((not s.is_active or not s.booking_enabled) and p_status<>'cancelled') then raise exception 'service_unavailable';end if;
 insert into business_calendar_settings(business_id) values(p_business) on conflict do nothing;
 select * into cfg from business_calendar_settings where business_id=p_business;
 if p_request_key like 'ig:%' then
  if not cfg.agent_booking_enabled then raise exception 'agent_booking_disabled';end if;
  if cfg.confirmation_mode='manual' then p_status:='pending';end if;
 end if;
 finish:=p_start+make_interval(mins=>s.duration_minutes);
 blocked:=finish+make_interval(mins=>s.buffer_minutes);
 if p_status<>'cancelled' then
  if p_start<=now() or p_start>now()+interval '90 days' then raise exception 'invalid_date';end if;
  local_start:=p_start at time zone cfg.timezone; local_end:=blocked at time zone cfg.timezone;
  if local_start::date<>local_end::date or cfg.closed_dates ? local_start::date::text or not exists(
   select 1 from jsonb_array_elements(cfg.hours) h where (h->>'day')::integer=extract(dow from local_start)::integer
    and local_start::time>=(h->>'start')::time and local_end::time<=(h->>'end')::time
  ) then raise exception 'outside_hours';end if;
  if s.hours is not null and not exists(
   select 1 from jsonb_array_elements(s.hours) h where (h->>'day')::integer=extract(dow from local_start)::integer
    and local_start::time>=(h->>'start')::time and local_end::time<=(h->>'end')::time
  ) then raise exception 'outside_service_hours';end if;
 end if;
 select * into connection from google_calendar_connections where business_id=p_business and connected and calendar_id is not null;
 if p_id is null then
  insert into bookings(business_id,service_id,service_name,customer_name,customer_contact,starts_at,ends_at,blocked_until,status,notes,request_key,sync_status)
   values(p_business,s.id,s.name,btrim(p_name),btrim(p_contact),p_start,finish,blocked,p_status,p_notes,p_request_key,
   case when connection.id is not null and p_status='confirmed' then 'pending' else 'local' end) returning * into b;
 else
  update bookings set service_id=s.id,service_name=s.name,customer_name=btrim(p_name),customer_contact=btrim(p_contact),
   starts_at=case when p_status='cancelled' then starts_at else p_start end,
   ends_at=case when p_status='cancelled' then ends_at else finish end,
   blocked_until=case when p_status='cancelled' then blocked_until else blocked end,
   status=p_status,notes=p_notes,revision=revision+1,updated_at=now(),
   sync_status=case when google_event_id is not null or (connection.id is not null and p_status='confirmed') then 'pending' else 'local' end
   where id=p_id and business_id=p_business returning * into b;
 end if;
 return b;
end $$;
revoke all on function public.save_calendar_booking(uuid,uuid,integer,uuid,text,text,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.save_calendar_booking(uuid,uuid,integer,uuid,text,text,timestamptz,text,text,text) to service_role;

