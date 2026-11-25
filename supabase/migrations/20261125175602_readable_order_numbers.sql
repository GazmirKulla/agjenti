begin;
-- Prevent inserts between historical numbering and installation of the allocator.
lock table public.orders in access exclusive mode;
alter table public.orders add column order_number integer;

create table public.order_number_counters (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  last_number integer not null check (last_number >= 1000)
);
alter table public.order_number_counters enable row level security;
revoke all on public.order_number_counters from public, anon, authenticated, service_role;
grant select, insert, update on public.order_number_counters to service_role;

with numbered as (
  select id, (1000 + row_number() over (partition by business_id order by created_at, id))::integer as number
  from public.orders
)
update public.orders o set order_number = n.number from numbered n where n.id = o.id;
insert into public.order_number_counters(business_id,last_number)
select business_id,max(order_number) from public.orders group by business_id;
alter table public.orders alter column order_number set not null;
alter table public.orders add constraint orders_business_number_unique unique (business_id,order_number);
alter table public.orders add constraint orders_number_positive check (order_number >= 1001);

-- Invoker privileges: only the existing trusted writers can allocate numbers.
-- The counter survives order deletion; its upsert serializes writers per business.
create function public.assign_order_number() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  if TG_OP = 'UPDATE' then
    if new.order_number is distinct from old.order_number or new.business_id is distinct from old.business_id then
      raise exception 'order_number_immutable';
    end if;
    return new;
  end if;
  -- Ignore supplied display numbers: allocation is always owned by the database.
  insert into public.order_number_counters as c(business_id,last_number)
    values(new.business_id,1001)
    on conflict (business_id) do update set last_number = c.last_number + 1
    returning last_number into new.order_number;
  return new;
end $$;
revoke all on function public.assign_order_number() from public, anon, authenticated;
create trigger assign_order_number before insert or update on public.orders
for each row execute function public.assign_order_number();
comment on column public.orders.order_number is 'Permanent customer-facing number, unique within the business. UUID remains the technical identity.';
commit;
