-- Business calendar: one appointment at a time, with optional Google Calendar.
create extension if not exists btree_gist;
create table public.business_calendar_settings (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 timezone text not null default 'Europe/Tirane',
 hours jsonb not null default '[{"day":1,"start":"09:00","end":"17:00"},{"day":2,"start":"09:00","end":"17:00"},{"day":3,"start":"09:00","end":"17:00"},{"day":4,"start":"09:00","end":"17:00"},{"day":5,"start":"09:00","end":"17:00"}]',
 closed_dates jsonb not null default '[]',
 confirmation_mode text not null default 'manual' check (confirmation_mode in ('manual','automatic')),
 agent_booking_enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.booking_services (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 name text not null check(length(btrim(name)) between 2 and 120),
 duration_minutes integer not null check(duration_minutes between 5 and 480),
 buffer_minutes integer not null default 0 check(buffer_minutes between 0 and 120),
 is_active boolean not null default true, created_at timestamptz not null default now(),
 unique (business_id,id)
);
create table public.google_calendar_connections (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 id uuid not null default gen_random_uuid(), calendar_id text, calendar_name text,
 access_token_encrypted text, refresh_token_encrypted text, expires_at timestamptz,
 connected boolean not null default true, updated_at timestamptz not null default now()
);
create table public.bookings (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 service_id uuid not null, service_name text not null, customer_name text not null check(length(btrim(customer_name)) between 2 and 120),
 customer_contact text not null default '' check(length(customer_contact)<=200), notes text not null default '' check(length(notes)<=1000),
 starts_at timestamptz not null, ends_at timestamptz not null, blocked_until timestamptz not null,
 status text not null check(status in ('pending','confirmed','cancelled')),
 request_key text, revision integer not null default 1,
 sync_status text not null default 'local' check(sync_status in ('local','pending','synced','error')),
 google_event_id text, google_calendar_id text, google_connection_id uuid,
 sync_lease uuid, sync_lease_until timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(business_id,service_id) references public.booking_services(business_id,id),
 check(starts_at<ends_at and ends_at<=blocked_until), unique(business_id,request_key),
 constraint bookings_no_overlap exclude using gist (business_id with =, tstzrange(starts_at,blocked_until,'[)') with &&) where(status in ('pending','confirmed'))
);
create index bookings_business_date on public.bookings(business_id,starts_at);
create index booking_services_business on public.booking_services(business_id);

alter table public.business_calendar_settings enable row level security;
alter table public.booking_services enable row level security;
alter table public.bookings enable row level security;
alter table public.google_calendar_connections enable row level security;
create policy calendar_settings_read on public.business_calendar_settings for select to authenticated using(is_business_member(business_id) or is_platform_admin());
create policy booking_services_read on public.booking_services for select to authenticated using(is_business_member(business_id) or is_platform_admin());
create policy bookings_read on public.bookings for select to authenticated using(is_business_member(business_id) or is_platform_admin());
-- Credentials are never readable through a browser client. Writes go through authorized server actions.
revoke all on public.business_calendar_settings,public.booking_services,public.bookings,public.google_calendar_connections from anon,authenticated;
grant select on public.business_calendar_settings,public.booking_services,public.bookings to authenticated;
grant all on public.business_calendar_settings,public.booking_services,public.bookings,public.google_calendar_connections to service_role;

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
 if not found or (not s.is_active and p_status<>'cancelled') then raise exception 'service_unavailable';end if;
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

create or replace function public.claim_booking_sync(p_business uuid,p_booking uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 update bookings set sync_lease=p_lease,sync_lease_until=now()+interval '2 minutes'
  where business_id=p_business and id=p_booking and sync_status in ('pending','error') and (sync_lease_until is null or sync_lease_until<=now());
 return found;
end $$;
revoke all on function public.claim_booking_sync(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_booking_sync(uuid,uuid,uuid) to service_role;
