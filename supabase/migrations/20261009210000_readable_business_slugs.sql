-- Readable business addresses, including workspaces created by onboarding.
-- Preserve the old UUID addresses so saved links still resolve to the tenant.
begin;

create table if not exists public.business_slug_aliases (
  slug text primary key,
  business_id uuid not null references public.businesses(id) on delete cascade
);
create index if not exists business_slug_aliases_business_idx on public.business_slug_aliases(business_id);
alter table public.business_slug_aliases enable row level security;
revoke all on public.business_slug_aliases from public, anon, authenticated;
grant all on public.business_slug_aliases to service_role;

create or replace function public.business_slug_base(p_name text)
returns text language sql immutable set search_path = public as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(
    lower(regexp_replace(normalize(btrim(p_name), NFD), U&'[\0300-\036f]', '', 'g')),
    '[^a-z0-9]+', '-', 'g')), ''), 'biznes');
$$;

create or replace function public.allocate_business_slug(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.business_slug_base(p_name);
  v_slug text := v_base;
  v_suffix integer := 0;
begin
  -- One transaction lock also covers overlapping bases, e.g. "shop" and
  -- "shop-1". Allocation and insertion occur in the same transaction.
  perform pg_advisory_xact_lock(726431, 1);
  while exists(select 1 from public.businesses where slug=v_slug)
    or exists(select 1 from public.business_slug_aliases where slug=v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix;
  end loop;
  return v_slug;
end;
$$;

create or replace function public.assign_business_slug()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_base text := public.business_slug_base(new.name);
begin
  -- Keep explicit custom addresses. Automatically resolve all name-derived
  -- addresses and legacy UUID inserts, including concurrent admin creations.
  perform pg_advisory_xact_lock(726431, 1);
  if new.slug is null or new.slug ~ '^biznes-[0-9a-f]{32}$'
    or new.slug ~ ('^' || v_base || '(-[0-9]+)?$') then
    new.slug := public.allocate_business_slug(new.name);
  elsif exists(select 1 from public.business_slug_aliases where slug=new.slug) then
    raise exception 'Business address is reserved' using errcode='23505';
  end if;
  return new;
end;
$$;
drop trigger if exists business_slug_on_insert on public.businesses;
create trigger business_slug_on_insert before insert on public.businesses
  for each row execute function public.assign_business_slug();

-- Retain the existing owner locking, idempotency and orphan restart behavior.
create or replace function public.complete_business_onboarding(p_user_id uuid, p_answers jsonb, p_instructions text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_business_id uuid;
  v_slug text;
  v_name text;
begin
  perform id from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Profile missing'; end if;
  if exists (select 1 from public.platform_admins where user_id = p_user_id) then
    raise exception 'Platform administrators use the admin workspace';
  end if;
  select b.slug into v_slug from public.business_users bu join public.businesses b on b.id = bu.business_id
    where bu.user_id = p_user_id order by b.name, b.id limit 1;
  if v_slug is not null then return v_slug; end if;
  delete from public.business_onboarding
    where user_id = p_user_id and completed_at is not null
      and not exists (select 1 from public.business_users where user_id = p_user_id);
  if exists (select 1 from public.business_onboarding where user_id = p_user_id and completed_at is not null) then
    raise exception 'This account already completed onboarding. Contact an administrator.';
  end if;
  v_name := btrim(p_answers->>'name');
  if v_name is null or length(v_name) < 2 or length(v_name) > 100
    or jsonb_typeof(p_answers->'useCases') is distinct from 'array'
    or length(coalesce(p_instructions,'')) = 0 then raise exception 'Invalid onboarding answers'; end if;
  v_business_id := gen_random_uuid();
  v_slug := public.allocate_business_slug(v_name);
  insert into public.businesses(id,name,slug,catalog_source,auto_reply)
    values(v_business_id,v_name,v_slug,'internal',false) returning slug into v_slug;
  insert into public.business_users(business_id,user_id,role) values(v_business_id,p_user_id,'owner');
  insert into public.ai_agents(business_id,name,instructions,is_active)
    values(v_business_id,'Agjenti i ' || v_name,p_instructions,false);
  insert into public.business_onboarding(user_id,business_id,answers,step,completed_at)
    values(p_user_id,v_business_id,p_answers,7,now())
    on conflict(user_id) do update set business_id=excluded.business_id, answers=excluded.answers,
      step=7, completed_at=now(), updated_at=now();
  return v_slug;
end;
$$;

revoke all on function public.business_slug_base(text) from public, anon, authenticated;
revoke all on function public.allocate_business_slug(text) from public, anon, authenticated;
revoke all on function public.assign_business_slug() from public, anon, authenticated;
revoke all on function public.complete_business_onboarding(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.business_slug_base(text) to service_role;
grant execute on function public.allocate_business_slug(text) to service_role;
grant execute on function public.complete_business_onboarding(uuid,jsonb,text) to service_role;

-- Only migrate the automatically generated UUID pattern. IDs and related
-- data remain attached to the same business; existing readable slugs stay put.
do $$
declare v_business record;
begin
  perform pg_advisory_xact_lock(726431, 1);
  for v_business in select id,name,slug from public.businesses
    where slug ~ '^biznes-[0-9a-f]{32}$' order by created_at,id loop
    insert into public.business_slug_aliases(slug,business_id)
      values(v_business.slug,v_business.id);
    update public.businesses set slug=public.allocate_business_slug(v_business.name)
      where id=v_business.id;
  end loop;
end;
$$;

commit;
