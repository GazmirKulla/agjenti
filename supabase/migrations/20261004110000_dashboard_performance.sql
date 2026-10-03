-- Support tenant date-range counts and newest-first lists without sorting all rows.
create index if not exists idx_conversations_business_created on public.conversations(business_id, created_at desc);
create index if not exists idx_orders_business_created on public.orders(business_id, created_at desc);
create index if not exists idx_customers_business_created on public.customers(business_id, created_at desc);
create index if not exists idx_orders_business_customer_created on public.orders(business_id, customer_id, created_at desc);

-- Called only after application authz, through the service-role server client.
-- Aggregate in PostgreSQL rather than making one HTTP count request per day.
create function public.dashboard_stats(p_business_id uuid, p_start timestamptz)
returns jsonb language sql stable security invoker set search_path = public as $$
with days as (
  select p_start + i * interval '24 hours' as day from generate_series(0,6) as i
), conversation_days as (
  select date_trunc('day', created_at at time zone 'UTC') at time zone 'UTC' as day, count(*) as n
  from public.conversations where (p_business_id is null or business_id = p_business_id)
    and created_at >= p_start and created_at < p_start + interval '168 hours'
  group by 1
), order_days as (
  select date_trunc('day', created_at at time zone 'UTC') at time zone 'UTC' as day, count(*) as n
  from public.orders where (p_business_id is null or business_id = p_business_id)
    and created_at >= p_start and created_at < p_start + interval '168 hours'
  group by 1
)
select jsonb_build_object(
  'conversations', (select count(*) from public.conversations where p_business_id is null or business_id = p_business_id),
  'orders', (select count(*) from public.orders where p_business_id is null or business_id = p_business_id),
  'customers', (select count(*) from public.customers where business_id = p_business_id),
  'connections', (select count(*) from public.instagram_connections where status = 'connected' and (p_business_id is null or business_id = p_business_id)),
  'agents', (select count(*) from public.ai_agents where is_active and (p_business_id is null or business_id = p_business_id)),
  'paused', (select count(*) from public.conversations where status = 'paused' and (p_business_id is null or business_id = p_business_id)),
  'totalBusinesses', (select count(*) from public.businesses where p_business_id is null),
  'trend', (select jsonb_agg(jsonb_build_object('date', d.day, 'conversations', coalesce(c.n,0), 'orders', coalesce(o.n,0)) order by d.day)
    from days d left join conversation_days c using(day) left join order_days o using(day))
);
$$;
revoke all on function public.dashboard_stats(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.dashboard_stats(uuid,timestamptz) to service_role;
