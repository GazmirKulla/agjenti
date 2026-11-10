-- Instagram and WhatsApp become one "channels" module. The old names stay in
-- the list until no deployed app version asks for them.
begin;

create or replace function public.business_module_allowed(p_business uuid, p_module text)
returns boolean language sql stable security definer set search_path=public, pg_temp as $$
 select exists(select 1 from businesses where id=p_business)
 and p_module=any(array['dashboard','inbox','activity','reports','products','services','orders','bookings','calendar','catalogs','leads','customers','agents','knowledge','workflows','sources','channels','instagram','whatsapp','settings'])
$$;

create or replace function public.allowed_business_modules(p_business uuid)
returns text[] language sql stable security definer set search_path=public, pg_temp as $$
 select coalesce(array_agg(m),array[]::text[]) from unnest(array['dashboard','inbox','activity','reports','products','services','orders','bookings','calendar','catalogs','leads','customers','agents','knowledge','workflows','sources','channels','instagram','whatsapp','settings']) m
 where business_module_allowed(p_business,m)
$$;

commit;
