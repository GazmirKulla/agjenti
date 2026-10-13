-- Repair databases that received action provisioning without the earlier
-- readable-slug helpers. Preserve existing business addresses and helpers.
begin;

create table if not exists public.business_slug_aliases (
  slug text primary key,
  business_id uuid not null references public.businesses(id) on delete cascade
);
create index if not exists business_slug_aliases_business_idx
  on public.business_slug_aliases(business_id);
alter table public.business_slug_aliases enable row level security;
revoke all on public.business_slug_aliases from public, anon, authenticated;
grant all on public.business_slug_aliases to service_role;

do $repair$
begin
  if to_regprocedure('public.business_slug_base(text)') is null then
    execute $definition$
      create function public.business_slug_base(p_name text)
      returns text language sql immutable set search_path = public as $body$
        select coalesce(nullif(trim(both '-' from regexp_replace(
          lower(regexp_replace(normalize(btrim(p_name), NFD), U&'[\0300-\036f]', '', 'g')),
          '[^a-z0-9]+', '-', 'g')), ''), 'biznes');
      $body$;
    $definition$;
  end if;

  if to_regprocedure('public.allocate_business_slug(text)') is null then
    execute $definition$
      create function public.allocate_business_slug(p_name text)
      returns text language plpgsql security definer set search_path = public as $body$
      declare
        v_base text := public.business_slug_base(p_name);
        v_slug text := v_base;
        v_suffix integer := 0;
      begin
        -- Match the lock used by other business-creation paths.
        perform pg_advisory_xact_lock(726431, 1);
        while exists(select 1 from public.businesses where slug = v_slug)
          or exists(select 1 from public.business_slug_aliases where slug = v_slug) loop
          v_suffix := v_suffix + 1;
          v_slug := v_base || '-' || v_suffix;
        end loop;
        return v_slug;
      end;
      $body$;
    $definition$;
  end if;
end;
$repair$;

revoke all on function public.business_slug_base(text) from public, anon, authenticated;
revoke all on function public.allocate_business_slug(text) from public, anon, authenticated;
grant execute on function public.business_slug_base(text) to service_role;
grant execute on function public.allocate_business_slug(text) to service_role;

commit;
