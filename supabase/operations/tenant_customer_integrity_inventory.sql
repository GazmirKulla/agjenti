-- Read-only S1 preflight. Run with an approved administrative read connection:
-- tenant RLS can hide the foreign customer and cannot establish a global count.
-- UUIDs only; no customer PII. This script performs no automatic repair.
begin read only;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select c.id as conversation_id, c.business_id as conversation_business_id,
  c.customer_id, customer.business_id as customer_business_id,
  case when customer.id is null then 'missing_customer' else 'foreign_customer' end as violation
from public.conversations c
left join public.customers customer on customer.id = c.customer_id
where c.customer_id is not null
  and (customer.id is null or customer.business_id <> c.business_id)
order by c.business_id, c.id;

-- Existing keys, validation state and inbound/outbound dependencies. Check the
-- definitions, not just names: a previous deployment may already have S1.
select conname, conrelid::regclass as source_table,
  nullif(confrelid, 0)::regclass as referenced_table, convalidated,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.customers'::regclass, 'public.conversations'::regclass)
   or confrelid in ('public.customers'::regclass, 'public.conversations'::regclass)
order by conrelid::regclass::text, conname;

select pg_describe_object(d.classid, d.objid, d.objsubid) as dependent_object,
  d.deptype, pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) as referenced_object
from pg_depend d
where d.refclassid = 'pg_constraint'::regclass
  and d.refobjid in (
    select oid from pg_constraint
    where conrelid in ('public.customers'::regclass, 'public.conversations'::regclass)
      and conname in ('customers_business_id_id_key', 'conversations_customer_id_fkey')
  );

-- Estimates and current contention only; this does not acquire rollout locks.
select c.oid::regclass as table_name, c.reltuples::bigint as estimated_rows,
  pg_size_pretty(pg_table_size(c.oid)) as table_size,
  pg_size_pretty(pg_indexes_size(c.oid)) as indexes_size,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
from pg_class c
where c.oid in ('public.customers'::regclass, 'public.conversations'::regclass);

select relation::regclass as table_name, mode, granted, count(*) as locks
from pg_locks
where relation in ('public.customers'::regclass, 'public.conversations'::regclass)
group by relation, mode, granted
order by relation::regclass::text, mode, granted;
commit;
