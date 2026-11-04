-- Include configured agents, imported sources and connected channels in navigation.
-- Existence only; no credentials or business rows are returned or modified.
begin;
create or replace function public.business_used_modules(p_business uuid) returns text[]
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(array_agg(module),array[]::text[]) from (
  select 'products' as module where exists(select 1 from products where business_id=p_business)
  union all select 'services' where exists(select 1 from booking_services where business_id=p_business)
  union all select 'orders' where exists(select 1 from orders where business_id=p_business)
  union all select 'bookings' where exists(select 1 from bookings where business_id=p_business)
  union all select 'calendar' where exists(select 1 from business_calendar_settings where business_id=p_business)
  union all select 'catalogs' where exists(select 1 from catalogs where business_id=p_business)
  union all select 'knowledge' where exists(select 1 from knowledge_entries where business_id=p_business)
  union all select 'customers' where exists(select 1 from customers where business_id=p_business)
  union all select 'workflows' where exists(select 1 from visual_workflows where business_id=p_business) or exists(select 1 from workflows where business_id=p_business)
  union all select 'agents' where exists(select 1 from ai_agents where business_id=p_business)
  union all select 'sources' where exists(select 1 from business_intelligence_sources where business_id=p_business)
  union all select 'instagram' where exists(select 1 from instagram_connections where business_id=p_business)
  union all select 'whatsapp' where exists(select 1 from whatsapp_connections where business_id=p_business)
 ) used
$$;
revoke all on function public.business_used_modules(uuid) from public,anon,authenticated;
grant execute on function public.business_used_modules(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
