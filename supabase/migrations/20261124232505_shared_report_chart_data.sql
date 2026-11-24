-- One daily source for reports and Assistant charts. Keep the existing internal-only RPC signature.
-- Invalid timezones fail explicitly; no fallback to a different reporting day.
begin;
create or replace function public.business_report(p_business uuid, p_days integer)
returns jsonb language sql stable security definer set search_path=public, pg_temp as $$
 with settings as (select timezone from public.businesses where id=p_business), bounds as (
  select (date_trunc('day', now() at time zone (select timezone from settings)) - make_interval(days => least(greatest(p_days,1),366)*2-1))::date as first_day,
         (now() at time zone (select timezone from settings))::date as last_day
 ), days as (
  select generate_series(first_day, last_day, interval '1 day')::date as day from bounds
 ), since as (
  select (first_day::timestamp at time zone (select timezone from settings)) as ts from bounds
 ),
 inbound as (select (created_at at time zone (select timezone from settings))::date d, count(*) n from messages
   where business_id=p_business and direction='inbound' and source='customer' and created_at>=(select ts from since) and created_at<now() group by 1),
 ai as (select (created_at at time zone (select timezone from settings))::date d, count(*) n from messages
   where business_id=p_business and direction='outbound' and source='agent' and created_at>=(select ts from since) and created_at<now() group by 1),
 ord as (select (created_at at time zone (select timezone from settings))::date d, count(*) n from orders
   where business_id=p_business and created_at>=(select ts from since) and created_at<now() group by 1),
 book as (select (created_at at time zone (select timezone from settings))::date d, count(*) n from bookings
   where business_id=p_business and created_at>=(select ts from since) and created_at<now() group by 1),
 cust as (select (created_at at time zone (select timezone from settings))::date d, count(*) n from customers
   where business_id=p_business and created_at>=(select ts from since) and created_at<now() group by 1)
 select jsonb_build_object(
  'timezone', (select timezone from settings),
  'generatedAt', now(),
  'days', coalesce(jsonb_agg(jsonb_build_object(
    'day', days.day,
    'inbound', coalesce(inbound.n,0), 'aiReplies', coalesce(ai.n,0),
    'orders', coalesce(ord.n,0), 'bookings', coalesce(book.n,0), 'customers', coalesce(cust.n,0)
  ) order by days.day), '[]'::jsonb),
  'aiMessagesThisPeriod', (select coalesce(sum(used),0) from business_usage where business_id=p_business
    and period_start<=now() and period_end>now()))
 from days
 left join inbound on inbound.d=days.day left join ai on ai.d=days.day
 left join ord on ord.d=days.day left join book on book.d=days.day left join cust on cust.d=days.day
$$;

revoke all on function public.business_report(uuid,integer) from public, anon, authenticated;
grant execute on function public.business_report(uuid,integer) to service_role;

commit;
