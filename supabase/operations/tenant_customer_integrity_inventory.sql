-- Read-only S1 preflight. Run with an approved administrative read connection:
-- tenant RLS can hide the foreign customer and cannot establish a global count.
-- UUIDs only; no customer PII. This script performs no automatic repair.
begin read only;
select c.id as conversation_id, c.business_id as conversation_business_id,
  c.customer_id, customer.business_id as customer_business_id,
  case when customer.id is null then 'missing_customer' else 'foreign_customer' end as violation
from public.conversations c
left join public.customers customer on customer.id = c.customer_id
where c.customer_id is not null
  and (customer.id is null or customer.business_id <> c.business_id)
order by c.business_id, c.id;
commit;
