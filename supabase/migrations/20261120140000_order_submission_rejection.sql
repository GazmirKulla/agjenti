-- Why the business website refused an order, kept with the order: the website's code, the field it named
-- and the item. Until now it reached only integration_logs, so a failed order showed no reason.
--
-- Additive. Rollback: alter table public.order_submissions drop column rejection;
begin;
set local lock_timeout='5s';

alter table public.order_submissions add column if not exists rejection jsonb
  check (rejection is null or (jsonb_typeof(rejection) = 'object' and octet_length(rejection::text) <= 1000));

-- Earlier refusals: the log row written in the same seconds as the refusal, for the same business.
-- When no row matches, the rejection stays empty and the order says its cause was not kept.
update public.order_submissions s set rejection = (
  select jsonb_strip_nulls(jsonb_build_object('code', split_part(l.error, ':', 1), 'field', nullif(split_part(l.error, ':', 2), ''), 'recovered', true))
  from public.integration_logs l
  where l.business_id = s.business_id and l.target = 'orders' and l.direction = 'outbound' and l.status = 'failed'
    and l.error ~ '^[a-z][a-z0-9_]*(:[A-Za-z0-9_.]+)?$'
    and l.created_at between s.resolved_at - interval '10 seconds' and s.resolved_at
  order by l.created_at desc limit 1)
where s.status = 'rejected' and s.rejection is null and s.resolved_at is not null;

notify pgrst, 'reload schema';
commit;
