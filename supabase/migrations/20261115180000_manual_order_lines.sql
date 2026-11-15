-- One manual order holds several items, each with its own product, variant, choices, extras,
-- fields, photos and quantity. Prices still come from the catalog, never from the client.
--
-- * order_items.selection: the line's raw selection with website ids; order_items.position: line order.
-- * manual_order_line checks and prices one line (the per-line part of create_manual_order);
--   its errors carry the 1-based line number, e.g. selection_required:2.
-- * create_manual_order_lines records one order with 1–10 lines.
-- * create_manual_order stays (app 0.3.10 calls it) as a one-line wrapper with the old error names.
-- * begin_order_dispatch sends all lines at once, or keeps the whole order local when any line can't be sent.
--
-- Requires 20261115160000_linked_catalog_orders.sql.
begin;

alter table public.order_items add column if not exists selection jsonb;
alter table public.order_items drop constraint if exists order_items_selection_shape;
alter table public.order_items add constraint order_items_selection_shape
  check (selection is null or (jsonb_typeof(selection)='object' and octet_length(selection::text)<=8192));
alter table public.order_items add column if not exists position integer;

-- One line of a manual order: {productId, variantId?, quantity, selection?}. Checks it against the
-- catalog and returns its priced form. The caller holds the conversation lock.
create or replace function public.manual_order_line(p_business uuid, p_conversation uuid, p_index integer, p_line jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p products; v product_variants; sel jsonb; qty numeric; unit numeric; extra numeric; chosen jsonb:='{}'::jsonb; opt jsonb;
 uuid_re constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
 begin
  if jsonb_typeof(p_line) is distinct from 'object' or jsonb_typeof(p_line->'productId') is distinct from 'string'
   or (p_line->>'productId') !~ uuid_re then raise exception 'invalid_lines'; end if;
  if p_line->'variantId' is not null and p_line->'variantId'<>'null'::jsonb
   and (jsonb_typeof(p_line->'variantId') is distinct from 'string' or (p_line->>'variantId') !~ uuid_re) then raise exception 'variant_unavailable'; end if;
  if jsonb_typeof(p_line->'quantity') is distinct from 'number' then raise exception 'invalid_quantity'; end if;
  qty:=(p_line->>'quantity')::numeric;
  if qty<=0 or qty>100000 then raise exception 'invalid_quantity'; end if;
  sel:=case when p_line->'selection' is null or p_line->'selection'='null'::jsonb then null else p_line->'selection' end;

  select * into p from products where id=(p_line->>'productId')::uuid and business_id=p_business for share;
  if not found or not p.is_active or p.archived_at is not null then raise exception 'product_unavailable'; end if;
  if jsonb_typeof(p_line->'variantId')='string' then
   select * into v from product_variants where id=(p_line->>'variantId')::uuid and product_id=p.id and business_id=p_business and is_active for share;
   if not found then raise exception 'variant_unavailable'; end if;
  elsif exists(select 1 from product_variants where product_id=p.id and business_id=p_business and is_active) then
   raise exception 'variant_required';
  end if;
  if v.price_amount is null and p.price_mode is distinct from 'fixed' then raise exception 'price_on_request'; end if;
  unit:=coalesce(v.price_amount, p.price_amount);
  if unit is null or unit<0 or p.currency !~ '^[A-Z]{3}$' then raise exception 'price_missing'; end if;
  extra:=check_order_selection(p_business, p_conversation, p, v, sel);
  unit:=unit+extra;
  -- Priced per unit (m³, m…): up to three decimals. Otherwise whole items, 1–999.
  if p.price_unit is null and (qty<>trunc(qty) or qty>999) then raise exception 'invalid_quantity'; end if;
  if p.price_unit is not null and not public.order_unit_quantity_ok(qty) then raise exception 'invalid_quantity'; end if;
  -- Readable choices on the order line, e.g. {"format": "A4", "color": "E bardhë"}.
  for opt in select value from jsonb_array_elements(coalesce(p.external_spec->'options','[]'::jsonb)) loop
   if sel#>>array['options',opt->>'key'] is not null then
    chosen:=chosen||jsonb_build_object(opt->>'key', (select x->>'name' from jsonb_array_elements(opt->'values') x where x->>'id'=sel#>>array['options',opt->>'key'] limit 1));
   end if;
  end loop;
 exception when raise_exception then
  raise exception '%:%', sqlerrm, p_index;
 end;
 return jsonb_build_object(
  'product_id',p.id,'variant_id',v.id,'variant',v.options,'product_name',p.name,'currency',p.currency,'unit',p.price_unit,
  'unit_amount',unit,'extra_amount',extra,'quantity',qty,'line_total',round(unit*qty,2),
  'options',coalesce(v.options,'{}'::jsonb)||chosen||coalesce(sel->'fields','{}'::jsonb),
  'selection',coalesce(nullif(sel,'{}'::jsonb),null),'price_unit',p.price_unit);
end $$;
revoke all on function public.manual_order_line(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.manual_order_line(uuid,uuid,integer,jsonb) to service_role;

-- A LOCAL order the owner records from a conversation, with 1–10 lines. Same rules as the
-- one-product order: membership, idempotent request key, customer filled but never overwritten.
create or replace function public.create_manual_order_lines(
  p_business uuid, p_user uuid, p_conversation uuid, p_lines jsonb, p_customer jsonb, p_note text, p_request_key text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.conversations; cid uuid; oid uuid; v_name text; v_phone text; line jsonb; lines jsonb:='[]'::jsonb;
 currency text; total numeric:=0; i integer;
begin
 if not exists(select 1 from business_users where business_id=p_business and user_id=p_user)
  and not exists(select 1 from platform_admins where user_id=p_user) then raise exception 'unauthorized'; end if;
 if p_request_key is null or char_length(p_request_key) not between 8 and 200 then raise exception 'invalid_request'; end if;
 select id into oid from orders where business_id=p_business and payload->>'source'='manual' and payload->>'requestKey'=p_request_key;
 if found then return oid; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 10 then raise exception 'invalid_lines'; end if;
 if jsonb_typeof(p_customer) is distinct from 'object' or octet_length(p_customer::text)>4000 then raise exception 'invalid_customer'; end if;
 v_name:=nullif(btrim(p_customer->>'name'),'');
 v_phone:=nullif(btrim(p_customer->>'phone'),'');
 if v_name is null or char_length(v_name) not between 2 and 120 or v_phone is null or char_length(v_phone)>40 then raise exception 'customer_required'; end if;
 if char_length(coalesce(p_note,''))>1000 then raise exception 'invalid_note'; end if;

 select * into c from conversations where id=p_conversation and business_id=p_business for update;
 if not found then raise exception 'invalid_conversation'; end if;
 for line, i in select value, ordinality from jsonb_array_elements(p_lines) with ordinality loop
  line:=manual_order_line(p_business, c.id, i::integer, line);
  if currency is null then currency:=line->>'currency';
  elsif currency<>line->>'currency' then raise exception 'mixed_currency'; end if;
  total:=total+(line->>'line_total')::numeric;
  lines:=lines||jsonb_build_array(line);
 end loop;

 -- The conversation's customer, an existing one with the same channel identity, or a new one.
 cid:=c.customer_id;
 if cid is not null then
  perform 1 from customers where id=cid and business_id=p_business;
  if not found then cid:=null; end if;
 end if;
 if cid is null and c.whatsapp_participant_id is not null then
  select id into cid from customers where business_id=p_business and whatsapp_user_id=c.whatsapp_participant_id limit 1;
 elsif cid is null and c.instagram_participant_id is not null then
  select id into cid from customers where business_id=p_business and instagram_user_id=c.instagram_participant_id limit 1;
 end if;
 if cid is null then
  insert into customers(business_id, instagram_user_id, whatsapp_user_id, username, display_name, phone)
   values(p_business, c.instagram_participant_id, c.whatsapp_participant_id, c.participant_username, v_name, v_phone) returning id into cid;
 else
  -- Fill only what the customer record is missing; saved details are never overwritten.
  update customers set phone=coalesce(customers.phone, v_phone), display_name=coalesce(customers.display_name, v_name), updated_at=now()
   where id=cid and (customers.phone is null or customers.display_name is null);
 end if;
 update conversations set customer_id=cid, updated_at=now() where id=c.id and customer_id is distinct from cid;

 insert into orders(business_id, conversation_id, customer_id, status, currency, total_amount, payload)
  values(p_business, c.id, cid, 'confirmed', currency, total, jsonb_build_object(
   'source','manual','requestKey',p_request_key,'createdBy',p_user,
   'lines',(select jsonb_agg(jsonb_build_object('product_id',l->'product_id','product_name',l->'product_name','variant_id',l->'variant_id',
     'variant',l->'variant','quantity',l->'quantity','unit',l->'unit','extra_amount',l->'extra_amount','line_total',l->'line_total') order by n)
     from jsonb_array_elements(lines) with ordinality t(l,n)),
   'customer',jsonb_build_object('name',v_name,'phone',v_phone,
     'city',nullif(btrim(p_customer->>'city'),''),'address',nullif(btrim(p_customer->>'address'),'')),
   'note',nullif(btrim(coalesce(p_note,'')),''))
   -- One line: the earlier top-level keys too, for readers of single-product orders.
   || case when jsonb_array_length(lines)=1 then jsonb_build_object(
     'product_id',lines#>'{0,product_id}','product_name',lines#>'{0,product_name}','variant_id',lines#>'{0,variant_id}',
     'variant',lines#>'{0,variant}','quantity',lines#>'{0,quantity}','unit',lines#>'{0,unit}',
     'selection',lines#>'{0,selection}','extra_amount',lines#>'{0,extra_amount}') else '{}'::jsonb end)
  returning id into oid;
 insert into order_items(order_id, product_id, variant_id, quantity, options, unit_amount, selection, position)
  select oid, (l->>'product_id')::uuid, (l->>'variant_id')::uuid, (l->>'quantity')::numeric, l->'options', (l->>'unit_amount')::numeric,
   case when jsonb_typeof(l->'selection')='object' then l->'selection' end, n::integer
  from jsonb_array_elements(lines) with ordinality t(l,n);
 return oid;
end $$;
revoke all on function public.create_manual_order_lines(uuid,uuid,uuid,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.create_manual_order_lines(uuid,uuid,uuid,jsonb,jsonb,text,text) to service_role;

-- The one-product order (app 0.3.10 and earlier): one line, with the error names it always had.
create or replace function public.create_manual_order(
  p_business uuid, p_user uuid, p_conversation uuid, p_product uuid, p_quantity numeric,
  p_customer jsonb, p_note text, p_request_key text, p_variant uuid default null, p_selection jsonb default null
) returns uuid language plpgsql security definer set search_path=public, pg_temp as $$
begin
 if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<=0 or p_quantity>100000 then
  -- Still idempotent: a retried request with a known key returns its order.
  if p_request_key is not null and exists(select 1 from orders where business_id=p_business and payload->>'source'='manual' and payload->>'requestKey'=p_request_key) then
   return create_manual_order_lines(p_business, p_user, p_conversation, '[]'::jsonb, p_customer, p_note, p_request_key);
  end if;
  raise exception 'invalid_quantity';
 end if;
 if p_product is null then raise exception 'product_unavailable'; end if;
 return create_manual_order_lines(p_business, p_user, p_conversation,
  jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('productId',p_product,'variantId',p_variant,'quantity',p_quantity))
   || case when p_selection is null then '{}'::jsonb else jsonb_build_object('selection',p_selection) end),
  p_customer, p_note, p_request_key);
exception when raise_exception then
 if sqlerrm ~ ':1$' then raise exception '%', regexp_replace(sqlerrm, ':1$', ''); end if;
 raise;
end $$;
revoke all on function public.create_manual_order(uuid,uuid,uuid,uuid,numeric,jsonb,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.create_manual_order(uuid,uuid,uuid,uuid,numeric,jsonb,text,text,uuid,jsonb) to service_role;

-- The single permission to send a manual order to the business website, with all its lines.
-- A second call (retry, double click, lost response) gets the recorded state and never a second permission.
-- When any line can't be sent, the whole order stays local: no partial order on the website.
create or replace function public.begin_order_dispatch(p_business uuid, p_user uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; it order_items; p products; v product_variants; c conversations; prior order_submissions; tid uuid;
 url text; sel jsonb; opts jsonb; opt jsonb; files jsonb; f record; items jsonb:='[]'::jsonb; n integer:=0;
begin
 perform assert_business_member(p_business, p_user);
 select * into o from orders where id=p_order and business_id=p_business for update;
 if not found or o.payload->>'source' is distinct from 'manual' then raise exception 'submission_unavailable'; end if;
 select * into prior from order_submissions where order_id=o.id;
 if found then
  return jsonb_build_object('orderId',o.id,'attemptId',prior.attempt_id,'status',prior.status,'externalOrderId',prior.external_order_id,'dispatch',false);
 end if;
 select nullif(btrim(orders_url),'') into url from integrations where business_id=p_business and kind='http';
 if url is null then return jsonb_build_object('orderId',o.id,'status','local_only','dispatch',false); end if;
 for it in select * from order_items where order_id=o.id order by position nulls first, id loop
  n:=n+1;
  p:=null; v:=null; opts:='{}'::jsonb; files:='[]'::jsonb;
  select * into p from products where id=it.product_id and business_id=p_business;
  if not found or p.source is distinct from 'linked' or p.external_id is null then
   return jsonb_build_object('orderId',o.id,'status','local_only','dispatch',false,'reason','unmapped_product','line',n);
  end if;
  -- Never refreshed from the website: its ids and required data are unknown, so nothing is sent.
  if p.external_spec is null then return jsonb_build_object('orderId',o.id,'status','local_only','dispatch',false,'reason','not_synced','line',n); end if;
  if it.variant_id is not null then
   select * into v from product_variants where id=it.variant_id and business_id=p_business;
   if v.external_id is null then return jsonb_build_object('orderId',o.id,'status','local_only','dispatch',false,'reason','unmapped_variant','line',n); end if;
  end if;
  -- Orders from before lines kept the selection on the order.
  sel:=coalesce(it.selection, o.payload->'selection', '{}'::jsonb);
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
  items:=items||jsonb_build_array(jsonb_build_object(
   'productId',p.external_id,'variantId',v.external_id,'options',opts,'addons',coalesce(sel->'addons','[]'::jsonb),
   'fields',coalesce(sel->'fields','{}'::jsonb),'files',files,'quantity',it.quantity,'unitAmount',it.unit_amount,
   -- Contract v1 readers: the variant and color ids under their old names.
   'formatId',v.external_id,'colorId',sel#>'{options,color}','character',sel#>'{fields,character}'));
 end loop;
 if n=0 then return jsonb_build_object('orderId',o.id,'status','local_only','dispatch',false,'reason','unmapped_product'); end if;
 select * into c from conversations where id=o.conversation_id and business_id=p_business;
 insert into order_submissions(order_id,business_id,conversation_id,confirmation_id,confirmation,state_revision,created_by,executor_kind)
  values(o.id,p_business,o.conversation_id,o.id,jsonb_build_object('source','manual','requestKey',o.payload->>'requestKey'),0,p_user,'owner')
  returning attempt_id into tid;
 update orders set status='pending_reconciliation', updated_at=now() where id=o.id;
 return jsonb_build_object('orderId',o.id,'attemptId',tid,'status','pending_reconciliation','dispatch',true,'payload',jsonb_build_object(
  'version',2,'channel',c.channel,'source','owner_manual',
  'customer',o.payload->'customer','fields','{}'::jsonb,'note',o.payload->'note','currency',o.currency,'expectedTotal',o.total_amount,
  'items',items));
end $$;
revoke all on function public.begin_order_dispatch(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_order_dispatch(uuid,uuid,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
