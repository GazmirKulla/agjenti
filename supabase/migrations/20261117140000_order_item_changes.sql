-- Staff change the items of an order that already exists (phase 2 of order changes): product,
-- variant, quantity, choices, extras and files, alongside the client, delivery details and note.
--
-- * order_change_values accepts `lines` (1–10 items, the same shape "Krijo porosi" sends).
-- * begin_order_change prices each new item from the catalog with manual_order_line (the same checks
--   and prices as a new order) and stores the priced items, the new total and the currency in the
--   change. Items that come out the same as the order's are not a change. For an order on the
--   business website it also returns `request`: what the website receives (contract v2 items, as
--   order_dispatch_payload builds them), sent again unchanged when an unclear answer is retried.
-- * finish_order_change, when the change is accepted, replaces order_items, the total and the
--   order's payload lines.
-- * order_dispatch_item: one website item, shared by order_dispatch_payload and the change request.
--
-- Requires 20261116200000_optional_customer_fields.sql and 20261115200000_agent_orders_v2.sql.
-- Rollback: re-run the function definitions of those two migrations and drop order_dispatch_item
-- and order_change_request.
begin;

-- One item as the business website receives it (contract v2), or {reason} when it can't be sent.
create or replace function public.order_dispatch_item(p_business uuid, p_product uuid, p_variant uuid, p_quantity numeric,
  p_unit numeric, p_selection jsonb, p_currency text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p products; v product_variants; sel jsonb; opts jsonb:='{}'::jsonb; opt jsonb; files jsonb:='[]'::jsonb; f record;
begin
 select * into p from products where id=p_product and business_id=p_business;
 if not found or p.source is distinct from 'linked' or p.external_id is null then return jsonb_build_object('reason','unmapped_product'); end if;
 -- Never refreshed from the website: its ids and required data are unknown, so nothing is sent.
 if p.external_spec is null then return jsonb_build_object('reason','not_synced'); end if;
 if p_variant is not null then
  select * into v from product_variants where id=p_variant and business_id=p_business;
  if v.external_id is null then return jsonb_build_object('reason','unmapped_variant'); end if;
 end if;
 sel:=coalesce(p_selection,'{}'::jsonb);
 if jsonb_typeof(sel) is distinct from 'object' then sel:='{}'::jsonb; end if;
 -- The variant's choices as the website's value ids, then the other choices as chosen.
 for opt in select value from jsonb_array_elements(coalesce(p.external_spec->'options','[]'::jsonb)) loop
  if v.options ? (opt->>'key') then
   opts:=opts||jsonb_build_object(opt->>'key',(select x->>'id' from jsonb_array_elements(opt->'values') x where x->>'name'=v.options->>(opt->>'key') limit 1));
  end if;
 end loop;
 opts:=opts||coalesce(sel->'options','{}'::jsonb);
 for f in select e.key, x.value as path from jsonb_each(coalesce(sel->'files','{}'::jsonb)) e, jsonb_array_elements_text(e.value) x loop
  files:=files||jsonb_build_array(jsonb_build_object('key',f.key,'path',f.path));
 end loop;
 return jsonb_build_object(
  'productId',p.external_id,'variantId',v.external_id,'options',opts,'addons',coalesce(sel->'addons','[]'::jsonb),
  'fields',coalesce(sel->'fields','{}'::jsonb),'files',files,'quantity',p_quantity,'unitAmount',p_unit,'currency',p_currency);
end $$;

-- Unchanged request, items built by order_dispatch_item.
create or replace function public.order_dispatch_payload(p_business uuid, p_order uuid, p_source text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare o orders; it order_items; c conversations; item jsonb; items jsonb:='[]'::jsonb; n integer:=0;
begin
 if p_source not in ('owner_manual','agent') then raise exception 'invalid_order_scope'; end if;
 select * into o from orders where id=p_order and business_id=p_business;
 if not found then raise exception 'submission_unavailable'; end if;
 for it in select * from order_items where order_id=o.id order by position nulls first, id loop
  n:=n+1;
  -- Orders from before lines kept the selection on the order.
  item:=order_dispatch_item(p_business, it.product_id, it.variant_id, it.quantity, it.unit_amount,
   coalesce(it.selection, o.payload->'selection'), o.currency);
  if item ? 'reason' then return item || jsonb_build_object('line',n); end if;
  items:=items||jsonb_build_array(item);
 end loop;
 if n=0 then return jsonb_build_object('reason','unmapped_product'); end if;
 select * into c from conversations where id=o.conversation_id and business_id=p_business;
 return jsonb_build_object('version',2,'channel',c.channel,'source',p_source,
  'customer',o.payload->'customer','fields','{}'::jsonb,'note',o.payload->'note','currency',o.currency,'expectedTotal',o.total_amount,
  'items',items);
end $$;

-- What a change may contain: the client and delivery fields (name, phone, city, address), the note
-- and the items (`lines`, priced later by begin_order_change). Raises invalid_change.
create or replace function public.order_change_values(p_changes jsonb, p_optional text[] default '{}') returns jsonb
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare out jsonb:='{}'::jsonb; c jsonb; k text; v text; limits jsonb:='{"name":120,"phone":40,"city":120,"address":300}';
begin
 if jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text) > 40000
   or exists(select 1 from jsonb_object_keys(p_changes) x where x not in ('customer','note','lines')) then raise exception 'invalid_change'; end if;
 if p_changes ? 'customer' then
  c:=p_changes->'customer';
  if jsonb_typeof(c) is distinct from 'object' or exists(select 1 from jsonb_object_keys(c) x where not limits ? x) then raise exception 'invalid_change'; end if;
  for k in select jsonb_object_keys(c) loop
   if jsonb_typeof(c->k) not in ('string','null') then raise exception 'invalid_change'; end if;
   v:=nullif(btrim(c->>k),'');
   if v is not null and char_length(v) > (limits->>k)::int then raise exception 'invalid_change'; end if;
   -- The website needs a name and a phone to deliver.
   if v is null and (k='name' or k='phone' and not 'phone'=any(p_optional)) then raise exception 'customer_required'; end if;
   if k='name' and char_length(v) < 2 then raise exception 'customer_required'; end if;
   out:=jsonb_set(out, array['customer'], coalesce(out->'customer','{}'::jsonb) || jsonb_build_object(k, v));
  end loop;
 end if;
 if p_changes ? 'note' then
  if jsonb_typeof(p_changes->'note') not in ('string','null') then raise exception 'invalid_change'; end if;
  v:=nullif(btrim(p_changes->>'note'),'');
  if v is not null and char_length(v) > 1000 then raise exception 'invalid_change'; end if;
  out:=out || jsonb_build_object('note', v);
 end if;
 if p_changes ? 'lines' then
  if jsonb_typeof(p_changes->'lines') is distinct from 'array' or jsonb_array_length(p_changes->'lines') not between 1 and 10 then raise exception 'invalid_lines'; end if;
  out:=out || jsonb_build_object('lines', p_changes->'lines');
 end if;
 return out;
end $$;

-- The order's payload with a change applied (only the keys the change names). Priced `lines`
-- become the payload lines; a single item also keeps the earlier top-level keys.
create or replace function public.order_change_apply(p_payload jsonb, p_changes jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select (
  (
   (case when p_changes ? 'customer'
     then jsonb_set(coalesce(p_payload,'{}'::jsonb), '{customer}', coalesce(p_payload->'customer','{}'::jsonb) || (p_changes->'customer'))
     else coalesce(p_payload,'{}'::jsonb) end)
   || (case when p_changes ? 'note' then jsonb_build_object('note', p_changes->'note') else '{}'::jsonb end)
   || (case when p_changes ? 'lines' then jsonb_build_object('lines',
       (select jsonb_agg(jsonb_build_object('product_id',l->'product_id','product_name',l->'product_name','variant_id',l->'variant_id',
         'variant',l->'variant','quantity',l->'quantity','unit',l->'unit','extra_amount',l->'extra_amount','line_total',l->'line_total') order by n)
        from jsonb_array_elements(p_changes->'lines') with ordinality t(l,n))) else '{}'::jsonb end)
  )
  - (case when p_changes ? 'lines' and jsonb_array_length(p_changes->'lines')<>1
      then array['product_id','product_name','variant_id','variant','quantity','unit','selection','extra_amount'] else array[]::text[] end)
 )
 || (case when p_changes ? 'lines' and jsonb_array_length(p_changes->'lines')=1 then jsonb_build_object(
     'product_id',p_changes#>'{lines,0,product_id}','product_name',p_changes#>'{lines,0,product_name}','variant_id',p_changes#>'{lines,0,variant_id}',
     'variant',p_changes#>'{lines,0,variant}','quantity',p_changes#>'{lines,0,quantity}','unit',p_changes#>'{lines,0,unit}',
     'selection',p_changes#>'{lines,0,selection}','extra_amount',p_changes#>'{lines,0,extra_amount}') else '{}'::jsonb end)
$$;

-- What the business website receives for a change: the client and delivery fields and the note as
-- changed and, when the items change, all of the new items with the new total.
create or replace function public.order_change_request(p_business uuid, p_change uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare ch order_changes; o orders; l jsonb; n integer; item jsonb; items jsonb:='[]'::jsonb; out jsonb:='{}'::jsonb;
begin
 select * into ch from order_changes where change_id=p_change and business_id=p_business;
 if not found then raise exception 'change_not_found'; end if;
 select * into o from orders where id=ch.order_id and business_id=p_business;
 if ch.changes ? 'customer' then out:=out || jsonb_build_object('customer', ch.changes->'customer'); end if;
 if ch.changes ? 'note' then out:=out || jsonb_build_object('note', ch.changes->'note'); end if;
 if ch.changes ? 'lines' then
  for l, n in select value, ordinality from jsonb_array_elements(ch.changes->'lines') with ordinality loop
   item:=order_dispatch_item(p_business, (l->>'product_id')::uuid, (l->>'variant_id')::uuid, (l->>'quantity')::numeric,
    (l->>'unit_amount')::numeric, l->'selection', ch.changes->>'currency');
   if item ? 'reason' then return item || jsonb_build_object('line',n); end if;
   items:=items||jsonb_build_array(item);
  end loop;
  out:=out || jsonb_build_object('items', items, 'currency', ch.changes->'currency', 'expectedTotal', ch.changes->'total');
 end if;
 return out;
end $$;

create or replace function public.finish_order_change(p_business uuid, p_change uuid, p_status text, p_error text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ch order_changes; o orders;
begin
 if p_status not in ('accepted','rejected','uncertain') then raise exception 'invalid_status'; end if;
 select * into ch from order_changes where change_id=p_change and business_id=p_business for update;
 if not found then raise exception 'change_not_found'; end if;
 -- A result arrives once; a settled change never moves again.
 if ch.status not in ('pending','uncertain') then return to_jsonb(ch); end if;
 if p_status='accepted' then
  select * into o from orders where id=ch.order_id and business_id=p_business for update;
  update orders set payload=order_change_apply(o.payload, ch.changes), updated_at=now(),
   total_amount=case when ch.changes ? 'lines' then (ch.changes->>'total')::numeric else total_amount end,
   currency=case when ch.changes ? 'lines' then ch.changes->>'currency' else currency end
   where id=o.id;
  if ch.changes ? 'lines' then
   delete from order_items where order_id=o.id;
   insert into order_items(order_id, product_id, variant_id, quantity, options, unit_amount, selection, position)
    select o.id, (l->>'product_id')::uuid, (l->>'variant_id')::uuid, (l->>'quantity')::numeric, l->'options', (l->>'unit_amount')::numeric,
     case when jsonb_typeof(l->'selection')='object' then l->'selection' end, n::integer
    from jsonb_array_elements(ch.changes->'lines') with ordinality t(l,n);
  end if;
  if ch.changes ? 'customer' and o.customer_id is not null then
   perform apply_order_contact(p_business, o.customer_id, ch.changes#>>'{customer,name}', ch.changes#>>'{customer,phone}');
  end if;
 end if;
 update order_changes set status=p_status, error=left(p_error,120), updated_at=now() where id=ch.id returning * into ch;
 return to_jsonb(ch);
end $$;

create or replace function public.begin_order_change(p_business uuid, p_user uuid, p_order uuid, p_change uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; ch order_changes; open_change order_changes; vals jsonb; before jsonb; is_external boolean;
 line jsonb; i integer; priced jsonb:='[]'::jsonb; currency text; total numeric:=0; now_items jsonb; new_items jsonb; request jsonb;
begin
 if not exists(select 1 from business_users where business_id=p_business and user_id=p_user)
  and not exists(select 1 from platform_admins where user_id=p_user) then raise exception 'unauthorized'; end if;
 if p_change is null then raise exception 'invalid_change'; end if;
 select * into ch from order_changes where change_id=p_change;
 if found then
  if ch.business_id<>p_business or ch.order_id<>p_order then raise exception 'change_conflict'; end if;
  -- The same request again: an uncertain (or long-pending) change is sent again with the same id.
  if ch.status='uncertain' or ch.status='pending' and ch.updated_at < now()-interval '2 minutes' then
   update order_changes set status='pending', updated_at=now() where id=ch.id returning * into ch;
   select * into o from orders where id=ch.order_id and business_id=p_business;
   return to_jsonb(ch) || jsonb_build_object('send', true, 'externalOrderId', o.external_order_id, 'request', order_change_request(p_business, p_change));
  end if;
  return to_jsonb(ch) || jsonb_build_object('send', false);
 end if;
 vals:=order_change_values(p_changes, (select optional_customer_fields from businesses where id=p_business));
 select * into o from orders where id=p_order and business_id=p_business for update;
 if not found then raise exception 'order_not_found'; end if;
 -- An order whose sending is still unverified is not changed until staff settle it.
 if o.status='pending_reconciliation' then raise exception 'order_unsettled'; end if;
 select * into open_change from order_changes where order_id=o.id and status in ('pending','uncertain') limit 1;
 if found then raise exception 'change_in_progress'; end if;
 before:=jsonb_build_object('customer', coalesce(o.payload->'customer','{}'::jsonb), 'note', o.payload->'note');

 if vals ? 'lines' then
  -- The files of an item belong to the order's conversation, as for a new order.
  if o.conversation_id is null then raise exception 'invalid_change'; end if;
  for line, i in select value, ordinality from jsonb_array_elements(vals->'lines') with ordinality loop
   line:=manual_order_line(p_business, o.conversation_id, i::integer, line);
   if currency is null then currency:=line->>'currency';
   elsif currency<>line->>'currency' then raise exception 'mixed_currency'; end if;
   total:=total+(line->>'line_total')::numeric;
   priced:=priced||jsonb_build_array(line);
  end loop;
  now_items:=(select coalesce(jsonb_agg(jsonb_build_array(product_id, variant_id, quantity, coalesce(selection,'{}'::jsonb)) order by position nulls first, id), '[]'::jsonb)
   from order_items where order_id=o.id);
  -- An empty selection is JSON null in a priced line and SQL null on order_items: both compare as {}.
  new_items:=(select coalesce(jsonb_agg(jsonb_build_array(l->'product_id', l->'variant_id', (l->>'quantity')::numeric,
    case when jsonb_typeof(l->'selection')='object' then l->'selection' else '{}'::jsonb end) order by n), '[]'::jsonb)
   from jsonb_array_elements(priced) with ordinality t(l,n));
  if now_items = new_items then vals:=vals-'lines';
  else
   vals:=vals || jsonb_build_object('lines', priced, 'total', round(total,2), 'currency', currency);
   before:=before || jsonb_build_object('lines', coalesce(o.payload->'lines', '[]'::jsonb), 'total', o.total_amount, 'currency', o.currency);
  end if;
 end if;
 if not vals ? 'lines' and order_change_apply(o.payload, vals) = o.payload then raise exception 'no_change'; end if;
 is_external:=o.external_system='external' and o.external_order_id is not null;
 insert into order_changes(business_id, order_id, change_id, source, requested_by, external, before, changes)
  values(p_business, o.id, p_change, 'owner', p_user, is_external, before, vals) returning * into ch;
 if not is_external then
  return finish_order_change(p_business, p_change, 'accepted') || jsonb_build_object('send', false);
 end if;
 request:=order_change_request(p_business, p_change);
 -- An item the website can't take (not linked or never synced): nothing is asked or changed.
 if request ? 'reason' then raise exception '%:%', request->>'reason', request->>'line'; end if;
 return to_jsonb(ch) || jsonb_build_object('send', true, 'externalOrderId', o.external_order_id, 'request', request);
end $$;

revoke all on function public.order_dispatch_item(uuid,uuid,uuid,numeric,numeric,jsonb,text) from public, anon, authenticated;
revoke all on function public.order_change_request(uuid,uuid) from public, anon, authenticated;
revoke all on function public.order_dispatch_payload(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.order_change_values(jsonb,text[]) from public, anon, authenticated;
revoke all on function public.order_change_apply(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.finish_order_change(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.begin_order_change(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.order_dispatch_item(uuid,uuid,uuid,numeric,numeric,jsonb,text) to service_role;
grant execute on function public.order_change_request(uuid,uuid) to service_role;
grant execute on function public.order_dispatch_payload(uuid,uuid,text) to service_role;
grant execute on function public.order_change_values(jsonb,text[]) to service_role;
grant execute on function public.order_change_apply(jsonb,jsonb) to service_role;
grant execute on function public.finish_order_change(uuid,uuid,text,text) to service_role;
grant execute on function public.begin_order_change(uuid,uuid,uuid,uuid,jsonb) to service_role;

commit;
