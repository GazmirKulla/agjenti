-- "staff" was a placeholder module: its page was removed and staff handoff is
-- gated by the inbox. Remove it from the module lists.
-- Apply only after the app version without the "staff" module is deployed:
-- older app versions still check for it before handing a conversation to staff.
begin;

create or replace function public.business_module_allowed(p_business uuid, p_module text)
returns boolean language sql stable security definer set search_path=public, pg_temp as $$
 select exists(select 1 from businesses where id=p_business)
 and p_module=any(array['dashboard','inbox','products','services','orders','bookings','calendar','catalogs','leads','customers','agents','knowledge','workflows','sources','instagram','whatsapp','settings'])
$$;

create or replace function public.allowed_business_modules(p_business uuid)
returns text[] language sql stable security definer set search_path=public, pg_temp as $$
 select coalesce(array_agg(m),array[]::text[]) from unnest(array['dashboard','inbox','products','services','orders','bookings','calendar','catalogs','leads','customers','agents','knowledge','workflows','sources','instagram','whatsapp','settings']) m
 where business_module_allowed(p_business,m)
$$;

commit;
