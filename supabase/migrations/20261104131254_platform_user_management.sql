-- Only the server's service role can read Auth data or write administrative receipts.
create table public.platform_user_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  target_id uuid not null,
  action text not null check (action in ('create', 'password', 'verify_email')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  created_at timestamptz not null default now()
);
alter table public.platform_user_events enable row level security;
revoke all on public.platform_user_events from public, anon, authenticated;
grant select, insert, update on public.platform_user_events to service_role;
create index platform_user_events_target on public.platform_user_events(target_id, created_at desc);

create function public.admin_list_users(p_search text default '', p_filter text default '', p_business uuid default null, p_page integer default 1)
-- Auth tables are not exposed to application roles. This narrowly scoped reader
-- runs with its owner's privileges, and is callable only by the service role.
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return (with filtered as (
    select u.id, u.email, coalesce(nullif(p.display_name, ''), u.raw_user_meta_data->>'full_name', u.email, 'Përdorues') as name,
      u.created_at, u.last_sign_in_at, u.email_confirmed_at,
      (u.banned_until > now()) as banned,
      exists(select 1 from public.platform_admins a where a.user_id = u.id) as admin,
      coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'role', m.role) order by b.name)
        from public.business_users m join public.businesses b on b.id = m.business_id where m.user_id = u.id), '[]'::jsonb) as businesses
    from auth.users u left join public.profiles p on p.id = u.id
    where (coalesce(u.email, '') ilike '%' || left(p_search, 100) || '%' or coalesce(p.display_name, '') ilike '%' || left(p_search, 100) || '%')
      and (p_business is null or exists(select 1 from public.business_users m where m.user_id = u.id and m.business_id = p_business))
      and (p_filter = '' or
        (p_filter = 'unverified' and u.email_confirmed_at is null) or
        (p_filter = 'verified' and u.email_confirmed_at is not null) or
        (p_filter = 'no-business' and not exists(select 1 from public.business_users m where m.user_id = u.id)) or
        (p_filter = 'admin' and exists(select 1 from public.platform_admins a where a.user_id = u.id)))
  ), page as (select * from filtered order by created_at desc, id limit 25 offset (greatest(1, least(p_page, 1000000)) - 1) * 25)
  select jsonb_build_object('total', (select count(*) from filtered), 'users', coalesce((select jsonb_agg(page) from page), '[]'::jsonb)));
end;
$$;
revoke all on function public.admin_list_users(text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, uuid, integer) to service_role;
