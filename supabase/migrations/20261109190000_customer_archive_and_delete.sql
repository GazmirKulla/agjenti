-- Customers can be removed from the list (archived, restorable) or deleted for
-- good by the business owner or a platform administrator. Deleting removes the
-- contact and their orders; Inbox conversations stay, unlinked from the customer
-- (conversations.customer_id would otherwise cascade-delete them).
alter table public.customers add column if not exists archived_at timestamptz;
create index if not exists customers_business_active on public.customers(business_id, created_at desc) where archived_at is null;

create or replace function public.manage_customer(p_business uuid, p_user uuid, p_customer uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_orders uuid[];
  v_conversations integer;
begin
  if not (exists(select 1 from business_users where business_id = p_business and user_id = p_user and role = 'owner')
          or exists(select 1 from platform_admins where user_id = p_user)) then
    raise exception 'customer_forbidden';
  end if;
  perform 1 from customers where id = p_customer and business_id = p_business for update;
  if not found then raise exception 'customer_not_found'; end if;
  if p_action = 'archive' then
    update customers set archived_at = now(), updated_at = now() where id = p_customer;
    return jsonb_build_object('action', 'archive');
  elsif p_action = 'restore' then
    update customers set archived_at = null, updated_at = now() where id = p_customer;
    return jsonb_build_object('action', 'restore');
  elsif p_action = 'delete' then
    select coalesce(array_agg(id), array[]::uuid[]) into v_orders from orders where customer_id = p_customer and business_id = p_business;
    delete from order_submissions where order_id = any(v_orders);
    delete from orders where id = any(v_orders);
    update conversations set customer_id = null, updated_at = now() where customer_id = p_customer and business_id = p_business;
    get diagnostics v_conversations = row_count;
    delete from customers where id = p_customer;
    return jsonb_build_object('action', 'delete', 'orders', coalesce(array_length(v_orders, 1), 0), 'conversations_kept', v_conversations);
  end if;
  raise exception 'customer_invalid_action';
end $$;
revoke all on function public.manage_customer(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.manage_customer(uuid, uuid, uuid, text) to service_role;

-- A new order brings an archived customer back to the active list.
create or replace function public.restore_customer_on_order() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.customer_id is not null then
    update customers set archived_at = null, updated_at = now() where id = new.customer_id and archived_at is not null;
  end if;
  return new;
end $$;
drop trigger if exists restore_customer_on_order on public.orders;
create trigger restore_customer_on_order after insert or update of customer_id on public.orders
  for each row execute function public.restore_customer_on_order();
