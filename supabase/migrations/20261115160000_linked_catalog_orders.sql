-- Linked products follow the business website (catalog contract v2) and the owner's
-- "Krijo" order from a conversation is sent to that website exactly once.
--
-- * product_variants.external_id: the website's id of the variant (e.g. a format).
-- * products.external_spec: what the website declares for the product (choices,
--   extras, fields the order needs). Refreshed from the website; never typed by hand.
-- * create_manual_order gains p_selection and checks it against external_spec.
-- * begin_order_dispatch grants the single permission to send a manual order and
--   builds the request from saved rows; finish_order_submission records the result.
begin;

alter table public.product_variants add column if not exists external_id text;
alter table public.product_variants drop constraint if exists product_variants_external_id_check;
alter table public.product_variants add constraint product_variants_external_id_check
  check (external_id is null or char_length(external_id) between 1 and 200);
create unique index if not exists product_variants_external_unique
  on public.product_variants(product_id, external_id) where external_id is not null;

alter table public.products add column if not exists external_spec jsonb;
alter table public.products add column if not exists external_synced_at timestamptz;
alter table public.products drop constraint if exists products_external_spec_shape;
alter table public.products add constraint products_external_spec_shape
  check (external_spec is null or (jsonb_typeof(external_spec)='object' and octet_length(external_spec::text)<=32768));

-- Private files the owner attaches to an order (reference photos); the website gets a short-lived link.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('order-files', 'order-files', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

create or replace function public.assert_business_member(p_business uuid, p_user uuid) returns void
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_user is null or (not exists(select 1 from business_users where business_id=p_business and user_id=p_user)
  and not exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
end $$;
revoke all on function public.assert_business_member(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_business_member(uuid,uuid) to service_role;

-- Refreshes one linked product from the website: prices, variants by external id, and the declaration.
-- Variants the website no longer offers are deactivated, not deleted (orders keep pointing at them).
create or replace function public.sync_linked_product(
  p_business uuid, p_user uuid, p_product uuid, p_price_mode text, p_price numeric, p_price_max numeric,
  p_price_unit text, p_currency text, p_variants jsonb, p_spec jsonb
) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare p products; item jsonb; found_id uuid; kept uuid[]:='{}'; i integer:=0;
begin
 perform assert_business_member(p_business, p_user);
 select * into p from products where id=p_product and business_id=p_business for update;
 if not found or p.source is distinct from 'linked' or p.external_id is null then raise exception 'product_unavailable'; end if;
 if p_price_mode not in ('fixed','from','range','request') or p_currency !~ '^[A-Z]{3}$'
  or (p_price_mode<>'request' and p_price is null) or (p_price is not null and (p_price<0 or p_price>9999999999.99))
  or (p_price_mode='range' and (p_price_max is null or p_price_max<p_price))
  or (p_price_unit is not null and char_length(p_price_unit) not between 1 and 20) then raise exception 'invalid_price'; end if;
 if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants)>100 then raise exception 'invalid_variant'; end if;
 if jsonb_typeof(p_spec) is distinct from 'object' or octet_length(p_spec::text)>32768 then raise exception 'invalid_spec'; end if;
 for item in select value from jsonb_array_elements(p_variants) loop
  i:=i+1;
  if jsonb_typeof(item->'external_id') is distinct from 'string' or char_length(item->>'external_id') not between 1 and 200 then raise exception 'invalid_variant'; end if;
  perform assert_product_variant(item);
  -- The website's variant, or an owner-made one with the same choices that it now takes over.
  select id into found_id from product_variants where product_id=p.id and business_id=p_business
    and (external_id=item->>'external_id' or (external_id is null and options=item->'options'))
    order by external_id nulls last limit 1;
  if found_id is null then
   insert into product_variants(business_id, product_id, options, sku, price_amount, is_active, position, external_id)
    values(p_business, p.id, item->'options', nullif(btrim(item->>'sku'),''), (item->>'price_amount')::numeric,
     coalesce((item->>'is_active')::boolean, true), i, item->>'external_id') returning id into found_id;
  else
   update product_variants set options=item->'options', sku=nullif(btrim(item->>'sku'),''), price_amount=(item->>'price_amount')::numeric,
    is_active=coalesce((item->>'is_active')::boolean, true), position=i, external_id=item->>'external_id', updated_at=now()
    where id=found_id;
  end if;
  kept:=kept||found_id;
 end loop;
 update product_variants set is_active=false, updated_at=now()
  where product_id=p.id and business_id=p_business and external_id is not null and not (id = any(kept));
 update products set price_mode=p_price_mode, price_amount=case when p_price_mode='request' then null else p_price end,
  price_max=case when p_price_mode='range' then p_price_max else null end, price_unit=p_price_unit, currency=p_currency,
  external_spec=p_spec, external_synced_at=now(), updated_at=now()
  where id=p.id;
 return coalesce(array_length(kept,1),0);
end $$;
revoke all on function public.sync_linked_product(uuid,uuid,uuid,text,numeric,numeric,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sync_linked_product(uuid,uuid,uuid,text,numeric,numeric,text,text,jsonb,jsonb) to service_role;

-- What the owner chose for a linked product, checked against the website's declaration.
-- Returns the price of the chosen extras. A product without a declaration takes no selection.
create or replace function public.check_order_selection(
  p_business uuid, p_conversation uuid, p_product products, p_variant product_variants, p_selection jsonb
) returns numeric language plpgsql stable set search_path=public,pg_temp as $$
declare spec jsonb:=p_product.external_spec; opt jsonb; fld jsonb; addon jsonb; val jsonb; files jsonb; extra numeric:=0;
 variant_keys text[]:=coalesce((select array_agg(k) from jsonb_object_keys(coalesce(p_variant.options,'{}'::jsonb)) k),'{}'); n integer;
begin
 if p_selection is null or p_selection='{}'::jsonb then p_selection:='{}'::jsonb; end if;
 if jsonb_typeof(p_selection) is distinct from 'object' or octet_length(p_selection::text)>8192
  or exists(select 1 from jsonb_object_keys(p_selection) k where k not in ('options','fields','files','addons')) then raise exception 'invalid_selection'; end if;
 if spec is null then
  if p_selection<>'{}'::jsonb then raise exception 'invalid_selection'; end if;
  return 0;
 end if;
 -- Choices that are not part of the variant (e.g. a color): one declared value each.
 if exists(select 1 from jsonb_each(coalesce(p_selection->'options','{}'::jsonb)) e
   where e.key = any(variant_keys) or not exists(select 1 from jsonb_array_elements(coalesce(spec->'options','[]'::jsonb)) o where o->>'key'=e.key)) then raise exception 'invalid_selection'; end if;
 for opt in select value from jsonb_array_elements(coalesce(spec->'options','[]'::jsonb)) loop
  continue when opt->>'key' = any(variant_keys);
  val:=p_selection#>array['options',opt->>'key'];
  if val is null then
   if coalesce((opt->>'required')::boolean,true) then raise exception 'selection_required'; end if;
   continue;
  end if;
  if jsonb_typeof(val) is distinct from 'string' or not exists(select 1 from jsonb_array_elements(coalesce(opt->'values','[]'::jsonb)) v where v->>'id'=val#>>'{}')
   then raise exception 'invalid_selection'; end if;
 end loop;
 -- Item data and files the website requires.
 if exists(select 1 from jsonb_object_keys(coalesce(p_selection->'fields','{}'::jsonb)) k
   where not exists(select 1 from jsonb_array_elements(coalesce(spec->'fields','[]'::jsonb)) f where f->>'key'=k and f->>'type' not in ('photo','file')))
  or exists(select 1 from jsonb_object_keys(coalesce(p_selection->'files','{}'::jsonb)) k
   where not exists(select 1 from jsonb_array_elements(coalesce(spec->'fields','[]'::jsonb)) f where f->>'key'=k and f->>'type' in ('photo','file')))
  then raise exception 'invalid_selection'; end if;
 for fld in select value from jsonb_array_elements(coalesce(spec->'fields','[]'::jsonb)) loop
  continue when coalesce(fld->>'appliesTo','item')<>'item';
  if fld->>'type' in ('photo','file') then
   files:=coalesce(p_selection#>array['files',fld->>'key'],'[]'::jsonb);
   if jsonb_typeof(files) is distinct from 'array' then raise exception 'invalid_selection'; end if;
   n:=jsonb_array_length(files);
   if n < greatest(coalesce((fld->>'min')::integer,0), case when coalesce((fld->>'required')::boolean,false) then 1 else 0 end)
    then raise exception 'selection_required'; end if;
   if n > least(coalesce((fld->>'max')::integer,5),10)
    or exists(select 1 from jsonb_array_elements(files) f where jsonb_typeof(f) is distinct from 'string'
     or (f#>>'{}') !~ ('^'||p_business::text||'/'||p_conversation::text||'/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif)$'))
    then raise exception 'invalid_selection'; end if;
   continue;
  end if;
  val:=p_selection#>array['fields',fld->>'key'];
  if val is null or val='null'::jsonb or (jsonb_typeof(val)='string' and btrim(val#>>'{}')='') then
   if coalesce((fld->>'required')::boolean,false) then raise exception 'selection_required'; end if;
   continue;
  end if;
  if (fld->>'type' in ('text','date','choice') and jsonb_typeof(val) is distinct from 'string')
   or (fld->>'type'='number' and jsonb_typeof(val) is distinct from 'number')
   or (fld->>'type'='boolean' and jsonb_typeof(val) is distinct from 'boolean')
   or (fld->>'type'='text' and char_length(val#>>'{}')>least(coalesce((fld->>'maxLength')::integer,500),1000))
   or (fld->>'type'='number' and ((fld ? 'min' and (val#>>'{}')::numeric<(fld->>'min')::numeric) or (fld ? 'max' and (val#>>'{}')::numeric>(fld->>'max')::numeric)))
   or (fld->>'type'='date' and (val#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$')
   or (fld->>'type'='choice' and not exists(select 1 from jsonb_array_elements(coalesce(fld->'values','[]'::jsonb)) v where v->>'id'=val#>>'{}'))
   then raise exception 'invalid_selection'; end if;
 end loop;
 -- Extras: declared, offered for this variant, each once.
 val:=coalesce(p_selection->'addons','[]'::jsonb);
 if jsonb_typeof(val) is distinct from 'array' or jsonb_array_length(val)>20
  or (select count(distinct x) from jsonb_array_elements_text(val) x)<>jsonb_array_length(val) then raise exception 'invalid_selection'; end if;
 for addon in select a from jsonb_array_elements(coalesce(spec->'addons','[]'::jsonb)) a where val ? (a->>'id') loop
  if jsonb_typeof(addon->'appliesToVariants')='array' and not (addon->'appliesToVariants' ? coalesce(p_variant.external_id,'')) then raise exception 'invalid_selection'; end if;
  if jsonb_typeof(addon->'price') is distinct from 'number' or (addon->>'price')::numeric<0 then raise exception 'invalid_selection'; end if;
  extra:=extra+(addon->>'price')::numeric;
 end loop;
 if (select count(*) from jsonb_array_elements(coalesce(spec->'addons','[]'::jsonb)) a where val ? (a->>'id'))<>jsonb_array_length(val) then raise exception 'invalid_selection'; end if;
 return extra;
end $$;
revoke all on function public.check_order_selection(uuid,uuid,products,product_variants,jsonb) from public,anon,authenticated;
grant execute on function public.check_order_selection(uuid,uuid,products,product_variants,jsonb) to service_role;

-- The selection is added; the old signature goes so the RPC call stays unambiguous.
drop function if exists public.create_manual_order(uuid,uuid,uuid,uuid,numeric,jsonb,text,text,uuid);
create or replace function public.create_manual_order(
  p_business uuid, p_user uuid, p_conversation uuid, p_product uuid, p_quantity numeric,
  p_customer jsonb, p_note text, p_request_key text, p_variant uuid default null, p_selection jsonb default null
) returns uuid language plpgsql security definer set search_path=public, pg_temp as $$
declare c public.conversations; p public.products; v public.product_variants; unit numeric; extra numeric; total numeric; cid uuid; oid uuid; v_name text; v_phone text;
 chosen jsonb:='{}'::jsonb; opt jsonb;
begin
 if not exists(select 1 from business_users where business_id = p_business and user_id = p_user)
  and not exists(select 1 from platform_admins where user_id = p_user) then raise exception 'unauthorized'; end if;
 if p_request_key is null or char_length(p_request_key) not between 8 and 200 then raise exception 'invalid_request'; end if;
 select id into oid from orders where business_id = p_business and payload->>'source' = 'manual' and payload->>'requestKey' = p_request_key;
 if found then return oid; end if;
 if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<=0 or p_quantity>100000 then raise exception 'invalid_quantity'; end if;
 if jsonb_typeof(p_customer) is distinct from 'object' or octet_length(p_customer::text) > 4000 then raise exception 'invalid_customer'; end if;
 v_name := nullif(btrim(p_customer->>'name'), '');
 v_phone := nullif(btrim(p_customer->>'phone'), '');
 if v_name is null or char_length(v_name) not between 2 and 120 or v_phone is null or char_length(v_phone) > 40 then raise exception 'customer_required'; end if;
 if char_length(coalesce(p_note, '')) > 1000 then raise exception 'invalid_note'; end if;

 select * into c from conversations where id = p_conversation and business_id = p_business for update;
 if not found then raise exception 'invalid_conversation'; end if;
 select * into p from products where id = p_product and business_id = p_business for share;
 if not found or not p.is_active or p.archived_at is not null then raise exception 'product_unavailable'; end if;
 if p_variant is not null then
  select * into v from product_variants where id = p_variant and product_id = p.id and business_id = p_business and is_active for share;
  if not found then raise exception 'variant_unavailable'; end if;
 elsif exists(select 1 from product_variants where product_id = p.id and business_id = p_business and is_active) then
  raise exception 'variant_required';
 end if;
 if v.price_amount is null and p.price_mode is distinct from 'fixed' then raise exception 'price_on_request'; end if;
 unit := coalesce(v.price_amount, p.price_amount);
 if unit is null or unit < 0 or p.currency !~ '^[A-Z]{3}$' then raise exception 'price_missing'; end if;
 extra := check_order_selection(p_business, c.id, p, v, p_selection);
 unit := unit + extra;
 -- Priced per unit (m³, m…): up to three decimals. Otherwise whole items, 1–999.
 if p.price_unit is null and (p_quantity <> trunc(p_quantity) or p_quantity > 999) then raise exception 'invalid_quantity'; end if;
 if p.price_unit is not null and not public.order_unit_quantity_ok(p_quantity) then raise exception 'invalid_quantity'; end if;
 total := round(unit * p_quantity, 2);
 -- Readable choices on the order line, e.g. {"format": "A4", "color": "E bardhë"}.
 for opt in select value from jsonb_array_elements(coalesce(p.external_spec->'options','[]'::jsonb)) loop
  if p_selection#>>array['options',opt->>'key'] is not null then
   chosen := chosen || jsonb_build_object(opt->>'key', (select x->>'name' from jsonb_array_elements(opt->'values') x where x->>'id'=p_selection#>>array['options',opt->>'key'] limit 1));
  end if;
 end loop;

 -- The conversation's customer, an existing one with the same channel identity, or a new one.
 cid := c.customer_id;
 if cid is not null then
  perform 1 from customers where id = cid and business_id = p_business;
  if not found then cid := null; end if;
 end if;
 if cid is null and c.whatsapp_participant_id is not null then
  select id into cid from customers where business_id = p_business and whatsapp_user_id = c.whatsapp_participant_id limit 1;
 elsif cid is null and c.instagram_participant_id is not null then
  select id into cid from customers where business_id = p_business and instagram_user_id = c.instagram_participant_id limit 1;
 end if;
 if cid is null then
  insert into customers(business_id, instagram_user_id, whatsapp_user_id, username, display_name, phone)
   values(p_business, c.instagram_participant_id, c.whatsapp_participant_id, c.participant_username, v_name, v_phone) returning id into cid;
 else
  -- Fill only what the customer record is missing; saved details are never overwritten.
  update customers set phone = coalesce(customers.phone, v_phone), display_name = coalesce(customers.display_name, v_name), updated_at = now()
   where id = cid and (customers.phone is null or customers.display_name is null);
 end if;
 update conversations set customer_id = cid, updated_at = now() where id = c.id and customer_id is distinct from cid;

 insert into orders(business_id, conversation_id, customer_id, status, currency, total_amount, payload)
  values(p_business, c.id, cid, 'confirmed', p.currency, total, jsonb_build_object(
   'source', 'manual', 'requestKey', p_request_key, 'createdBy', p_user,
   'product_id', p.id, 'product_name', p.name, 'variant_id', v.id, 'variant', v.options, 'quantity', p_quantity, 'unit', p.price_unit,
   'selection', coalesce(nullif(p_selection,'{}'::jsonb), null), 'extra_amount', extra,
   'customer', jsonb_build_object('name', v_name, 'phone', v_phone,
     'city', nullif(btrim(p_customer->>'city'), ''), 'address', nullif(btrim(p_customer->>'address'), '')),
   'note', nullif(btrim(coalesce(p_note, '')), '')))
  returning id into oid;
 insert into order_items(order_id, product_id, variant_id, quantity, options, unit_amount)
  values(oid, p.id, v.id, p_quantity, coalesce(v.options, '{}'::jsonb) || chosen || coalesce(p_selection->'fields','{}'::jsonb), unit);
 return oid;
end $$;
revoke all on function public.create_manual_order(uuid,uuid,uuid,uuid,numeric,jsonb,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.create_manual_order(uuid,uuid,uuid,uuid,numeric,jsonb,text,text,uuid,jsonb) to service_role;

-- The single permission to send a manual order to the business website. A second call (retry,
-- double click, lost response) gets the recorded state and never a second permission.
create or replace function public.begin_order_dispatch(p_business uuid, p_user uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; it order_items; p products; v product_variants; c conversations; prior order_submissions; tid uuid;
 url text; sel jsonb; opts jsonb:='{}'::jsonb; opt jsonb; files jsonb:='[]'::jsonb; f record;
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
 select * into it from order_items where order_id=o.id limit 1;
 select * into p from products where id=it.product_id and business_id=p_business;
 if not found or p.source is distinct from 'linked' or p.external_id is null then
  return jsonb_build_object('orderId',o.id,'status','local_only','dispatch',false,'reason','unmapped_product');
 end if;
 -- Never refreshed from the website: its ids and required data are unknown, so nothing is sent.
 if p.external_spec is null then return jsonb_build_object('orderId',o.id,'status','local_only','dispatch',false,'reason','not_synced'); end if;
 if it.variant_id is not null then
  select * into v from product_variants where id=it.variant_id and business_id=p_business;
  if v.external_id is null then return jsonb_build_object('orderId',o.id,'status','local_only','dispatch',false,'reason','unmapped_variant'); end if;
 end if;
 select * into c from conversations where id=o.conversation_id and business_id=p_business;
 sel:=coalesce(o.payload->'selection','{}'::jsonb);
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
 insert into order_submissions(order_id,business_id,conversation_id,confirmation_id,confirmation,state_revision,created_by,executor_kind)
  values(o.id,p_business,o.conversation_id,o.id,jsonb_build_object('source','manual','requestKey',o.payload->>'requestKey'),0,p_user,'owner')
  returning attempt_id into tid;
 update orders set status='pending_reconciliation', updated_at=now() where id=o.id;
 return jsonb_build_object('orderId',o.id,'attemptId',tid,'status','pending_reconciliation','dispatch',true,'payload',jsonb_build_object(
  'version',2,'channel',c.channel,'source','owner_manual',
  'customer',o.payload->'customer','fields','{}'::jsonb,'note',o.payload->'note','currency',o.currency,'expectedTotal',o.total_amount,
  'items',jsonb_build_array(jsonb_build_object(
   'productId',p.external_id,'variantId',v.external_id,'options',opts,'addons',coalesce(sel->'addons','[]'::jsonb),
   'fields',coalesce(sel->'fields','{}'::jsonb),'files',files,'quantity',it.quantity,'unitAmount',it.unit_amount,
   -- Contract v1 readers: the variant and color ids under their old names.
   'formatId',v.external_id,'colorId',sel#>'{options,color}','character',sel#>'{fields,character}'))));
end $$;
revoke all on function public.begin_order_dispatch(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_order_dispatch(uuid,uuid,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
