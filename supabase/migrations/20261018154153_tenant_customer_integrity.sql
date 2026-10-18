-- S1: a CRM customer linked to a conversation must belong to the same business.
-- Preflight: supabase/operations/tenant_customer_integrity_inventory.sql.
-- Forward only: never unlink, reassign or delete historical customer data here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Fence both sides before inventory/DDL; no concurrent reparenting can race it.
-- A busy/large deployment must abort and reschedule, not disable integrity checks.
lock table public.customers, public.conversations in share row exclusive mode;
do $$
declare invalid_count bigint;
begin
  select count(*) into invalid_count
  from public.conversations c
  left join public.customers customer on customer.id = c.customer_id
  where c.customer_id is not null
    and (customer.id is null or customer.business_id <> c.business_id);
  if invalid_count > 0 then
    raise exception 'tenant_customer_integrity_invalid_relationships: %', invalid_count
      using hint = 'Run the read-only inventory; resolve ownership through a separately approved data repair before retrying.';
  end if;
end $$;

alter table public.customers
  add constraint customers_business_id_id_key unique (business_id, id);

-- Replace, do not add a second customer relation: PostgREST must retain one
-- unambiguous embed. Preserve its name, NULL allowance and existing CASCADE.
alter table public.conversations
  drop constraint conversations_customer_id_fkey,
  add constraint conversations_customer_id_fkey
    foreign key (business_id, customer_id)
    references public.customers (business_id, id)
    on delete cascade;

-- idx_conversations_customer already indexes customer_id (globally unique).
-- No RLS, grants, RPCs, customer identity or workflow state is changed.
notify pgrst, 'reload schema';
commit;
