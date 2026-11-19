-- Capability events: every entry and exit of what the customer agent and the Assistant do, as codes only
-- (no message text, no personal data). Written by the server after the work it describes is committed;
-- read only by the server for Platform Admin. Kept 90 days.
--
-- * mark_abandoned_capabilities: a started capability with no exit after p_hours is recorded once as
--   abandoned (the customer left the process unfinished).
-- * prune_capability_events: removes events older than p_days.
--
-- Additive; the app tolerates its absence (recording is best effort).
-- Rollback: drop function public.mark_abandoned_capabilities(integer), public.prune_capability_events(integer),
--           public.capability_health(timestamptz, timestamptz, uuid), public.capability_daily(timestamptz, timestamptz, uuid),
--           public.capability_last_seen(uuid);
--           drop table public.capability_events;
begin;
set local lock_timeout='5s';

create table if not exists public.capability_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  agent text not null check (agent in ('customer','assistant')),
  capability text not null check (capability ~ '^[a-z]+\.[a-z0-9_.]+$' and length(capability) <= 80),
  point text not null check (point ~ '^[a-z_]+$' and length(point) <= 40),
  outcome text not null check (outcome in ('entry','success','failure','handoff','neutral')),
  reason text check (reason is null or (reason ~ '^[A-Za-z0-9_.:-]+$' and length(reason) <= 80)),
  mode text not null default 'live' check (mode in ('live','test')),
  conversation_id uuid,
  ref text check (ref is null or length(ref) <= 200),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now()
);
create index if not exists capability_events_created on public.capability_events (created_at desc);
create index if not exists capability_events_capability on public.capability_events (capability, created_at desc);
create index if not exists capability_events_business on public.capability_events (business_id, created_at desc);
create index if not exists capability_events_ref on public.capability_events (ref) where ref is not null;
-- An abandoned process is recorded once.
create unique index if not exists capability_events_abandoned_once on public.capability_events (capability, ref) where point = 'abandoned';

alter table public.capability_events enable row level security;
revoke all on public.capability_events from public, anon, authenticated;
grant all on public.capability_events to service_role;

create or replace function public.mark_abandoned_capabilities(p_hours integer default 24) returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare marked integer;
begin
  if p_hours is null or p_hours < 1 or p_hours > 720 then raise exception 'invalid_hours'; end if;
  insert into public.capability_events (business_id, agent, capability, point, outcome, reason, mode, conversation_id, ref)
  select s.business_id, s.agent, s.capability, 'abandoned', 'failure', 'no_exit_after_' || p_hours || 'h', s.mode, s.conversation_id, s.ref
  from public.capability_events s
  where s.outcome = 'entry' and s.ref is not null and s.agent = 'customer'
    and s.created_at < now() - make_interval(hours => p_hours) and s.created_at > now() - interval '90 days'
    and not exists (select 1 from public.capability_events e where e.ref = s.ref and e.capability = s.capability and e.outcome <> 'entry')
  on conflict do nothing;
  get diagnostics marked = row_count;
  return marked;
end $$;

create or replace function public.prune_capability_events(p_days integer default 90) returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare removed integer;
begin
  if p_days is null or p_days < 7 then raise exception 'invalid_days'; end if;
  delete from public.capability_events where created_at < now() - make_interval(days => p_days);
  get diagnostics removed = row_count;
  return removed;
end $$;

-- Platform Admin reads (live events only): counts per capability, point and reason with up to three
-- example conversations; counts per day; and when each capability was last seen.
create or replace function public.capability_health(p_from timestamptz, p_to timestamptz, p_business uuid default null)
returns table(capability text, point text, outcome text, reason text, events bigint, businesses bigint, examples text[])
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select e.capability, e.point, e.outcome, e.reason, count(*), count(distinct e.business_id),
    (array_agg(distinct e.business_id::text || ':' || e.conversation_id::text) filter (where e.conversation_id is not null))[1:3]
  from public.capability_events e
  where e.mode = 'live' and e.created_at >= p_from and e.created_at < p_to and (p_business is null or e.business_id = p_business)
  group by e.capability, e.point, e.outcome, e.reason
$$;
create or replace function public.capability_daily(p_from timestamptz, p_to timestamptz, p_business uuid default null)
returns table(day date, agent text, outcome text, events bigint)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select (e.created_at at time zone 'Europe/Tirane')::date, e.agent, e.outcome, count(*)
  from public.capability_events e
  where e.mode = 'live' and e.created_at >= p_from and e.created_at < p_to and (p_business is null or e.business_id = p_business)
  group by 1, 2, 3
$$;
create or replace function public.capability_last_seen(p_business uuid default null)
returns table(capability text, last_at timestamptz)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select e.capability, max(e.created_at) from public.capability_events e
  where e.mode = 'live' and (p_business is null or e.business_id = p_business) group by e.capability
$$;

revoke all on function public.mark_abandoned_capabilities(integer), public.prune_capability_events(integer),
  public.capability_health(timestamptz, timestamptz, uuid), public.capability_daily(timestamptz, timestamptz, uuid),
  public.capability_last_seen(uuid) from public, anon, authenticated;
grant execute on function public.mark_abandoned_capabilities(integer), public.prune_capability_events(integer),
  public.capability_health(timestamptz, timestamptz, uuid), public.capability_daily(timestamptz, timestamptz, uuid),
  public.capability_last_seen(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
