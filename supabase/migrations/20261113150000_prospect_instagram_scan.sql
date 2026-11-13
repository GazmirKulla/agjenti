begin;
-- A platform power: the customer agent of a business (Agjenti.app) may read the
-- public Instagram profile a prospect names in the chat. Off on every plan; a
-- platform admin allows it per business in /admin/businesses/<id>/permissions.
insert into platform_actions(key) values('prospect.instagram_scan') on conflict(key) do nothing;
insert into plan_actions(plan,action_key,enabled)
select p,'prospect.instagram_scan',false from unnest(array['free','starter','professional','enterprise']) p
on conflict(plan,action_key) do nothing;

-- Public data only, read when the prospect gave the @username. Kept 30 days.
create table if not exists public.prospect_scans (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 username text not null check(username ~ '^[a-z0-9._]{1,30}$'),
 status text not null default 'queued' check(status in ('queued','running','ready','not_found','failed')),
 profile jsonb, posts jsonb, stats jsonb, error text,
 attempts integer not null default 0, leased_until timestamptz,
 fetched_at timestamptz,
 target_business_id uuid references public.businesses(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 days',
 unique(business_id,conversation_id,username)
);
create index if not exists prospect_scans_business_month on public.prospect_scans(business_id,created_at);
create index if not exists prospect_scans_due on public.prospect_scans(status,updated_at) where status in ('queued','running');
alter table public.prospect_scans enable row level security;
revoke all on public.prospect_scans from anon, authenticated;
grant all on public.prospect_scans to service_role;

-- Whether the business may scan, and its monthly allowance (null = no limit set).
create or replace function public.prospect_scan_policy(p_business uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'allowed', business_policy_allowed(p_business,'prospect.instagram_scan'),
  'monthlyLimit', coalesce(
    (select o.monthly_limit from business_actions o where o.business_id=p_business and o.action_key='prospect.instagram_scan' and (o.expires_at is null or o.expires_at>now())),
    (select pa.monthly_limit from business_billing b join plan_actions pa on pa.plan=b.plan and pa.action_key='prospect.instagram_scan' where b.business_id=p_business)))
$$;
revoke all on function public.prospect_scan_policy(uuid) from public,anon,authenticated;
grant execute on function public.prospect_scan_policy(uuid) to service_role;

-- A worker claims one due scan; a crashed lease is taken again after 3 minutes.
create or replace function public.claim_prospect_scan(p_id uuid) returns public.prospect_scans
language plpgsql security definer set search_path=public,pg_temp as $$
declare s prospect_scans;
begin
 update prospect_scans set status='running',attempts=attempts+1,leased_until=now()+interval '3 minutes',updated_at=now()
  where id=p_id and attempts<3 and (status='queued' or status='running' and leased_until<now())
  returning * into s;
 return s;
end $$;
revoke all on function public.claim_prospect_scan(uuid) from public,anon,authenticated;
grant execute on function public.claim_prospect_scan(uuid) to service_role;
commit;
