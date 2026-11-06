begin;
-- A deletion request disables sign-in immediately (Auth ban). The account is
-- purged after the recovery window unless a platform administrator restores it.
create table public.account_deletions (
 user_id uuid primary key,
 status text not null default 'scheduled' check (status in ('scheduled','purging','restored','completed')),
 requested_at timestamptz not null default now(),
 purge_after timestamptz not null,
 claimed_at timestamptz,
 attempts integer not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from public, anon, authenticated;
grant select, insert, update, delete on public.account_deletions to service_role;
create index account_deletions_due on public.account_deletions(purge_after) where status in ('scheduled','purging');

-- Repeating a request keeps the original recovery window.
create function public.schedule_account_deletion(p_user uuid, p_days integer)
returns table(purge_after timestamptz, created boolean)
language plpgsql security definer set search_path = '' as $$
begin
 if coalesce(auth.role(), '') <> 'service_role' then
  raise exception 'Forbidden' using errcode = '42501';
 end if;
 if exists(select 1 from public.platform_admins a where a.user_id = p_user) then
  raise exception 'admin_protected' using errcode = '42501';
 end if;
 return query
  insert into public.account_deletions as d(user_id, purge_after)
  values (p_user, now() + make_interval(days => p_days))
  on conflict (user_id) do update
   set status = 'scheduled', requested_at = now(), purge_after = excluded.purge_after,
       claimed_at = null, attempts = 0, updated_at = now()
   where d.status in ('restored','completed')
  returning d.purge_after, true;
 if not found then
  return query select d.purge_after, false from public.account_deletions d where d.user_id = p_user;
 end if;
end;
$$;
revoke all on function public.schedule_account_deletion(uuid, integer) from public, anon, authenticated;
grant execute on function public.schedule_account_deletion(uuid, integer) to service_role;

-- Stale claims are retried; administrators are never claimed.
create function public.claim_account_deletions(p_limit integer)
returns setof uuid
language sql security definer set search_path = '' as $$
 update public.account_deletions d
  set status = 'purging', claimed_at = now(), attempts = d.attempts + 1, updated_at = now()
 where d.user_id in (
  select c.user_id from public.account_deletions c
  where ((c.status = 'scheduled' and c.purge_after <= now())
     or (c.status = 'purging' and c.claimed_at < now() - interval '15 minutes'))
    and not exists(select 1 from public.platform_admins a where a.user_id = c.user_id)
  order by c.purge_after
  limit greatest(1, least(p_limit, 50))
  for update skip locked)
 returning d.user_id;
$$;
revoke all on function public.claim_account_deletions(integer) from public, anon, authenticated;
grant execute on function public.claim_account_deletions(integer) to service_role;

alter table public.platform_user_events drop constraint platform_user_events_action_check;
alter table public.platform_user_events add constraint platform_user_events_action_check
 check (action in ('create', 'password', 'verify_email', 'restore'));

-- These references previously blocked deleting an Auth user.
do $$
declare r record;
begin
 for r in
  select c.conname, c.conrelid::regclass as tbl
  from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
   and ((c.conrelid = 'public.conversations'::regclass and a.attname = 'panel_user_id')
     or (c.conrelid = 'public.business_invitations'::regclass and a.attname = 'accepted_by')
     or (c.conrelid = 'public.action_policy_events'::regclass and a.attname = 'actor_id')
     or (c.conrelid = 'public.business_automation_policies'::regclass and a.attname = 'authorized_by'))
 loop
  execute format('alter table %s drop constraint %I', r.tbl, r.conname);
 end loop;
end $$;
alter table public.conversations add constraint conversations_panel_user_id_fkey
 foreign key (panel_user_id) references auth.users(id) on delete set null;
alter table public.business_invitations add constraint business_invitations_accepted_by_fkey
 foreign key (accepted_by) references auth.users(id) on delete set null;
alter table public.action_policy_events add constraint action_policy_events_actor_id_fkey
 foreign key (actor_id) references auth.users(id) on delete set null;
-- Without its authorizing owner the policy is removed: automation stays off
-- until a remaining owner authorizes it again.
alter table public.business_automation_policies add constraint business_automation_policies_authorized_by_fkey
 foreign key (authorized_by) references auth.users(id) on delete cascade;
commit;
