-- Product stock, optional and configured by each business.
--
-- * businesses.stock_settings: when an order takes stock (deduct: confirmed | accepted | manual), what the
--   customer is told (display: availability | low | exact, with lowThreshold) and the mode a new product
--   starts with (defaultMode). The agent reads display through the server's projection; the order trigger
--   reads deduct; the product form reads defaultMode.
-- * products.stock_mode: off (not counted, stock_quantity null), tracked (a count), unique (one piece:
--   it is sold when its count reaches 0). product_variants.stock_quantity: a variant's own count; null
--   means the variant uses the product's count.
-- * stock_movements: every change with its reason (order, order_release, adjustment, tracking_start),
--   so counts can be explained and an order's stock can be released exactly.
-- * sync_order_stock: one idempotent rule run by triggers on orders, order_items and order_submissions.
--   It moves stock to what the order should hold now under the business's deduct setting, so amendments,
--   rejections, failures and deletions release or take exactly the difference. It never raises: a count
--   may go below zero (oversold) rather than break an order's own transaction.
-- * set_product_stock: the owner's counts from the product form, recorded as adjustments.
--
-- Products linked to the business website are not counted here (the website owns their stock).
-- Rollback: drop the triggers, the functions and stock_movements, then the added columns.
begin;
set local lock_timeout='5s';

create or replace function public.valid_stock_settings(p jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(p)='object'
  and p->>'deduct' in ('confirmed','accepted','manual')
  and p->>'display' in ('availability','low','exact')
  and p->>'defaultMode' in ('off','tracked','unique')
  and jsonb_typeof(p->'lowThreshold')='number' and (p->>'lowThreshold')::numeric between 1 and 1000
  and (p - array['deduct','display','defaultMode','lowThreshold'])='{}'::jsonb, false)
$$;

alter table public.businesses add column if not exists stock_settings jsonb not null
 default '{"deduct":"confirmed","display":"availability","defaultMode":"off","lowThreshold":3}'::jsonb;
alter table public.businesses drop constraint if exists businesses_stock_settings_valid;
alter table public.businesses add constraint businesses_stock_settings_valid check (public.valid_stock_settings(stock_settings));

alter table public.products add column if not exists stock_mode text not null default 'off';
alter table public.products add column if not exists stock_quantity numeric;
alter table public.products drop constraint if exists products_stock_mode_check;
alter table public.products add constraint products_stock_mode_check check (stock_mode in ('off','tracked','unique'));
alter table public.products drop constraint if exists products_stock_quantity_check;
alter table public.products add constraint products_stock_quantity_check
 check ((stock_mode='off' and stock_quantity is null) or (stock_mode<>'off' and (stock_quantity is null or stock_quantity between -10000000 and 10000000)));
alter table public.product_variants add column if not exists stock_quantity numeric;
alter table public.product_variants drop constraint if exists product_variants_stock_quantity_check;
alter table public.product_variants add constraint product_variants_stock_quantity_check
 check (stock_quantity is null or stock_quantity between -10000000 and 10000000);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  -- Kept as written: a removed variant or order leaves its history readable.
  variant_id uuid,
  order_id uuid,
  delta numeric not null,
  quantity_after numeric,
  reason text not null check (reason in ('order','order_release','adjustment','tracking_start')),
  actor_user uuid,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_product on public.stock_movements(business_id, product_id, created_at desc);
create index if not exists stock_movements_order on public.stock_movements(order_id) where order_id is not null;
alter table public.stock_movements enable row level security;
revoke all on public.stock_movements from anon, authenticated;
grant select on public.stock_movements to authenticated;
grant all on public.stock_movements to service_role;
drop policy if exists "tenant select stock movements" on public.stock_movements;
create policy "tenant select stock movements" on public.stock_movements
  for select to authenticated using (public.is_business_member(business_id));

-- A unique piece is sold when its count reaches 0 and available again when it comes back.
create or replace function public.sync_unique_availability(p_product uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 update products set availability=case when stock_quantity<=0 then 'sold' else 'available' end
  where id=p_product and stock_mode='unique' and stock_quantity is not null and availability in ('available','sold')
   and availability is distinct from case when stock_quantity<=0 then 'sold' else 'available' end;
end $$;

create or replace function public.sync_order_stock(p_order uuid) returns void
language plpgsql security definer set search_path=public as $$
declare o orders; sub order_submissions; v_business uuid; v_deduct text; v_committed boolean:=false; r record; v_after numeric;
begin
 if p_order is null then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('order_stock:'||p_order::text,0));
 select * into o from orders where id=p_order;
 v_business:=coalesce(o.business_id,(select business_id from stock_movements where order_id=p_order limit 1));
 if v_business is null then return; end if;
 select stock_settings->>'deduct' into v_deduct from businesses where id=v_business;
 -- Manual stock: orders never move it, including releases of what they took under an earlier setting.
 if v_deduct is null or v_deduct='manual' then return; end if;
 if o.id is not null then
  select * into sub from order_submissions where order_id=p_order;
  if o.status in ('draft','failed') or sub.status='rejected' then v_committed:=false;
  elsif v_deduct='confirmed' then v_committed:=o.status in ('confirmed','submitted','pending_reconciliation');
  else v_committed:=(sub.order_id is not null and sub.status in ('accepted','local_only'))
   or (sub.order_id is null and o.status in ('confirmed','submitted'));
  end if;
 end if;
 for r in
  with wanted as (
   select i.product_id, case when v.stock_quantity is not null then v.id end as variant_id, sum(i.quantity) as qty
   from order_items i
   join products p on p.id=i.product_id and p.business_id=v_business and p.stock_mode<>'off' and coalesce(p.source,'')<>'linked'
   left join product_variants v on v.id=i.variant_id and v.product_id=p.id
   where v_committed and i.order_id=p_order
     and (v.stock_quantity is not null or p.stock_quantity is not null)
   group by 1,2
  ), held as (
   select product_id, variant_id, -sum(delta) as qty from stock_movements
   where order_id=p_order and reason in ('order','order_release') group by 1,2
  )
  select coalesce(w.product_id,h.product_id) as product_id, coalesce(w.variant_id,h.variant_id) as variant_id,
   coalesce(w.qty,0)-coalesce(h.qty,0) as diff
  -- FULL JOIN needs a plain equality: an absent variant compares as the nil uuid.
  from wanted w full join held h on h.product_id=w.product_id
   and coalesce(h.variant_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(w.variant_id,'00000000-0000-0000-0000-000000000000'::uuid)
 loop
  continue when r.diff=0;
  v_after:=null;
  if r.variant_id is not null then
   update product_variants set stock_quantity=stock_quantity-r.diff, updated_at=now()
    where id=r.variant_id and product_id=r.product_id and stock_quantity is not null returning stock_quantity into v_after;
  else
   update products set stock_quantity=stock_quantity-r.diff
    where id=r.product_id and business_id=v_business and stock_mode<>'off' and stock_quantity is not null returning stock_quantity into v_after;
  end if;
  -- A count that is no longer tracked keeps its history; nothing is written for it.
  continue when v_after is null;
  insert into stock_movements(business_id,product_id,variant_id,order_id,delta,quantity_after,reason)
   values(v_business,r.product_id,r.variant_id,p_order,-r.diff,v_after,case when r.diff>0 then 'order' else 'order_release' end);
  perform sync_unique_availability(r.product_id);
 end loop;
end $$;

create or replace function public.order_stock_trigger() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if TG_TABLE_NAME='order_items' then
  if TG_OP in ('UPDATE','DELETE') then perform sync_order_stock(old.order_id); end if;
  if TG_OP='INSERT' or (TG_OP='UPDATE' and new.order_id is distinct from old.order_id) then perform sync_order_stock(new.order_id); end if;
 elsif TG_TABLE_NAME='orders' then
  perform sync_order_stock(case when TG_OP='DELETE' then old.id else new.id end);
 else
  perform sync_order_stock(new.order_id);
 end if;
 return null;
end $$;

drop trigger if exists order_items_stock on public.order_items;
create trigger order_items_stock after insert or update of quantity, variant_id, product_id, order_id or delete on public.order_items
 for each row execute function public.order_stock_trigger();
drop trigger if exists orders_stock on public.orders;
create trigger orders_stock after update of status or delete on public.orders
 for each row execute function public.order_stock_trigger();
drop trigger if exists order_submissions_stock on public.order_submissions;
create trigger order_submissions_stock after insert or update of status on public.order_submissions
 for each row execute function public.order_stock_trigger();

-- The owner's counts from the product form. Variants are matched by their options (new variant rows
-- have no id in the form); a null quantity on a variant means it uses the product's count.
create or replace function public.set_product_stock(p_business uuid,p_user uuid,p_product uuid,p_mode text,p_quantity numeric,p_variants jsonb default '[]'::jsonb)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare p products; item jsonb; v product_variants; v_new numeric; v_old numeric;
begin
 perform assert_order_actor(p_business,p_user);
 if p_mode not in ('off','tracked','unique') or jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants)>100
  or (p_quantity is not null and (p_quantity<0 or p_quantity>10000000)) then raise exception 'invalid_stock'; end if;
 select * into p from products where id=p_product and business_id=p_business for update;
 if not found then raise exception 'product_unavailable'; end if;
 if p_mode<>'off' and coalesce(p.source,'')='linked' then raise exception 'stock_linked'; end if;
 if p_mode='off' then
  update products set stock_mode='off', stock_quantity=null where id=p.id;
  update product_variants set stock_quantity=null, updated_at=now() where product_id=p.id and stock_quantity is not null;
  return jsonb_build_object('mode','off');
 end if;
 v_old:=case when p.stock_mode='off' then null else p.stock_quantity end;
 v_new:=case when p_mode='unique' then coalesce(least(p_quantity,1),least(v_old,1),1) else p_quantity end;
 update products set stock_mode=p_mode, stock_quantity=v_new where id=p.id;
 if v_new is not null and v_new is distinct from v_old then
  insert into stock_movements(business_id,product_id,delta,quantity_after,reason,actor_user)
   values(p_business,p.id,v_new-coalesce(v_old,0),v_new,case when v_old is null then 'tracking_start' else 'adjustment' end,p_user);
 end if;
 if p_mode='unique' then
  update product_variants set stock_quantity=null, updated_at=now() where product_id=p.id and stock_quantity is not null;
 else
  for item in select value from jsonb_array_elements(p_variants) loop
   if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'options') is distinct from 'object'
    or (item->'quantity' is not null and jsonb_typeof(item->'quantity') not in ('number','null'))
    or (jsonb_typeof(item->'quantity')='number' and ((item->>'quantity')::numeric<0 or (item->>'quantity')::numeric>10000000)) then raise exception 'invalid_stock'; end if;
   select * into v from product_variants where product_id=p.id and options=item->'options' for update;
   continue when not found;
   v_new:=case when jsonb_typeof(item->'quantity')='number' then (item->>'quantity')::numeric end;
   continue when v_new is not distinct from v.stock_quantity;
   update product_variants set stock_quantity=v_new, updated_at=now() where id=v.id;
   if v_new is not null then
    insert into stock_movements(business_id,product_id,variant_id,delta,quantity_after,reason,actor_user)
     values(p_business,p.id,v.id,v_new-coalesce(v.stock_quantity,0),v_new,case when v.stock_quantity is null then 'tracking_start' else 'adjustment' end,p_user);
   end if;
  end loop;
 end if;
 perform sync_unique_availability(p.id);
 return jsonb_build_object('mode',p_mode);
end $$;

revoke all on function public.sync_order_stock(uuid), public.order_stock_trigger(), public.sync_unique_availability(uuid),
 public.set_product_stock(uuid,uuid,uuid,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.set_product_stock(uuid,uuid,uuid,text,numeric,jsonb) to service_role;
grant execute on function public.valid_stock_settings(jsonb) to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
