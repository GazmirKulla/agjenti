-- Changing the items of an existing order (20261117140000_order_item_changes.sql).
-- Run only in an isolated test database after all migrations; everything is rolled back.
begin;
create temp table ids as select gen_random_uuid() as business, gen_random_uuid() as owner, gen_random_uuid() as conversation,
  gen_random_uuid() as tee, gen_random_uuid() as small, gen_random_uuid() as medium, gen_random_uuid() as box,
  gen_random_uuid() as local_order, gen_random_uuid() as web_order;
insert into auth.users(id) select owner from ids;
insert into public.businesses(id,name,slug) select business,'Item Change Test','order-item-change-test' from ids;
insert into public.business_users(business_id,user_id,role) select business,owner,'owner' from ids;
insert into public.conversations(id,business_id) select conversation,business from ids;
-- A product linked to the website (size as the variant, a colour choice) and one only in Agjenti.
insert into public.products(id,business_id,name,price_amount,currency,is_active,source,external_id,external_spec)
 select tee,business,'Bluzë',null,'ALL',true,'linked','web-tee',jsonb_build_object('version',2,'addons','[]'::jsonb,'fields','[]'::jsonb,
  'options',jsonb_build_array(
   jsonb_build_object('key','size','label','Masa','required',true,'affectsPrice',true,'values',jsonb_build_array(
     jsonb_build_object('id','sz-s','name','S'),jsonb_build_object('id','sz-m','name','M'))),
   jsonb_build_object('key','color','label','Ngjyra','required',true,'affectsPrice',false,'values',jsonb_build_array(
     jsonb_build_object('id','col-red','name','E kuqe'),jsonb_build_object('id','col-blue','name','Blu')))))
 from ids;
insert into public.product_variants(id,business_id,product_id,options,price_amount,external_id)
 select small,business,tee,'{"size":"S"}',1000,'web-s' from ids;
insert into public.product_variants(id,business_id,product_id,options,price_amount,external_id)
 select medium,business,tee,'{"size":"M"}',1200,'web-m' from ids;
insert into public.products(id,business_id,name,price_amount,currency,is_active) select box,business,'Kuti',300,'ALL',true from ids;

-- One order only in Agjenti and one on the website, each with one small red tee.
insert into public.orders(id,business_id,conversation_id,status,currency,total_amount,payload) select local_order,business,conversation,'confirmed','ALL',1000,
  '{"customer":{"name":"Bora","phone":"0691111111"},"note":null,"lines":[{"product_name":"Bluzë","quantity":1}]}' from ids;
insert into public.orders(id,business_id,conversation_id,status,currency,total_amount,external_system,external_order_id,payload)
 select web_order,business,conversation,'submitted','ALL',1000,'external','ord_1','{"customer":{"name":"Bora","phone":"0691111111"},"note":null}' from ids;
insert into public.order_items(order_id,product_id,variant_id,quantity,options,unit_amount,selection,position)
 select o,tee,small,1,'{"size":"S","color":"E kuqe"}',1000,'{"options":{"color":"col-red"}}',1 from ids, unnest(array[local_order,web_order]) o;

create function pg_temp.fails(sql text, code text) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then
  if sqlerrm<>code then raise exception 'expected % got %',code,sqlerrm; end if; return; end;
 raise exception 'expected %',code;
end $$;
create function pg_temp.lines(i ids, body text) returns jsonb language sql as $$
 select jsonb_build_object('lines', replace(replace(replace(replace(body,'TEE',i.tee::text),'SMALL',i.small::text),'MEDIUM',i.medium::text),'BOX',i.box::text)::jsonb)
$$;

-- A local order changes at once: items, prices from the catalog, total, payload lines and the history.
do $$ declare i ids; r jsonb; o orders; n integer; begin
 select * into i from ids;
 r:=begin_order_change(i.business,i.owner,i.local_order,'60000000-0000-4000-8000-000000000001',
   pg_temp.lines(i,'[{"productId":"TEE","variantId":"MEDIUM","quantity":2,"selection":{"options":{"color":"col-blue"}}},{"productId":"BOX","quantity":1}]'));
 if r->>'status'<>'accepted' or (r->>'send')::boolean then raise exception 'local %',r; end if;
 select * into o from orders where id=i.local_order;
 if o.total_amount<>2700 or o.currency<>'ALL' then raise exception 'total %',o.total_amount; end if;
 if jsonb_array_length(o.payload->'lines')<>2 or o.payload ? 'product_id' or o.payload#>>'{customer,name}'<>'Bora' then raise exception 'payload %',o.payload; end if;
 select count(*) into n from order_items where order_id=i.local_order;
 if n<>2 then raise exception 'items %',n; end if;
 if (select unit_amount from order_items where order_id=i.local_order and position=1)<>1200
  or (select selection#>>'{options,color}' from order_items where order_id=i.local_order and position=1)<>'col-blue'
  or (select options->>'color' from order_items where order_id=i.local_order and position=1)<>'Blu' then raise exception 'item'; end if;
 if (select (before->>'total')::numeric from order_changes where change_id='60000000-0000-4000-8000-000000000001')<>1000
  or (select (changes->>'total')::numeric from order_changes where change_id='60000000-0000-4000-8000-000000000001')<>2700 then raise exception 'history'; end if;
 -- Back to one item: the earlier single-product keys come back.
 r:=begin_order_change(i.business,i.owner,i.local_order,'60000000-0000-4000-8000-000000000002',pg_temp.lines(i,'[{"productId":"BOX","quantity":3}]'));
 select * into o from orders where id=i.local_order;
 if o.total_amount<>900 or o.payload->>'product_id'<>i.box::text or o.payload->>'quantity'<>'3' then raise exception 'single %',o.payload; end if;
 -- The same items again are not a change; with a note they change only the note.
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.local_order,gen_random_uuid(),pg_temp.lines(i,'[{"productId":"BOX","quantity":3}]')),'no_change');
 r:=begin_order_change(i.business,i.owner,i.local_order,'60000000-0000-4000-8000-000000000003',pg_temp.lines(i,'[{"productId":"BOX","quantity":3}]')||'{"note":"Me nxitim"}');
 if r->'changes' ? 'lines' or (select payload->>'note' from orders where id=i.local_order)<>'Me nxitim' then raise exception 'note only %',r; end if;
end $$;

-- An order on the website: nothing changes until the website accepts; the request carries the website's items.
do $$ declare i ids; r jsonb; begin
 select * into i from ids;
 r:=begin_order_change(i.business,i.owner,i.web_order,'60000000-0000-4000-8000-000000000004',
   pg_temp.lines(i,'[{"productId":"TEE","variantId":"MEDIUM","quantity":1,"selection":{"options":{"color":"col-red"}}}]'));
 if r->>'status'<>'pending' or not (r->>'send')::boolean then raise exception 'pending %',r; end if;
 if r#>>'{request,items,0,productId}'<>'web-tee' or r#>>'{request,items,0,variantId}'<>'web-m'
  or r#>>'{request,items,0,options,size}'<>'sz-m' or r#>>'{request,items,0,options,color}'<>'col-red'
  or (r#>>'{request,expectedTotal}')::numeric<>1200 or r->'request' ? 'customer' then raise exception 'request %',r->'request'; end if;
 if (select total_amount from orders where id=i.web_order)<>1000 then raise exception 'changed early'; end if;
 -- An unclear answer is sent again with the same request.
 perform finish_order_change(i.business,'60000000-0000-4000-8000-000000000004','uncertain','uncertain');
 r:=begin_order_change(i.business,i.owner,i.web_order,'60000000-0000-4000-8000-000000000004','{}');
 if r#>>'{request,items,0,variantId}'<>'web-m' then raise exception 'retry %',r; end if;
 r:=finish_order_change(i.business,'60000000-0000-4000-8000-000000000004','accepted');
 if (select total_amount from orders where id=i.web_order)<>1200 or (select variant_id from order_items where order_id=i.web_order)<>i.medium then raise exception 'accepted'; end if;
 -- A product the website doesn't know is refused before anything is asked.
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.web_order,gen_random_uuid(),pg_temp.lines(i,'[{"productId":"BOX","quantity":1}]')),'unmapped_product:1');
 if exists(select 1 from order_changes where order_id=i.web_order and status in ('pending','uncertain')) then raise exception 'left open'; end if;
end $$;

-- Refusals: catalog checks per item, the number of items.
do $$ declare i ids; begin
 select * into i from ids;
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.local_order,gen_random_uuid(),pg_temp.lines(i,'[{"productId":"BOX","quantity":1},{"productId":"TEE","quantity":1}]')),'variant_required:2');
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.local_order,gen_random_uuid(),pg_temp.lines(i,'[{"productId":"BOX","quantity":0}]')),'invalid_quantity:1');
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.local_order,gen_random_uuid(),'{"lines":[]}'),'invalid_lines');
end $$;

do $$ begin
 if has_function_privilege('authenticated','public.order_change_request(uuid,uuid)','execute')
  or has_function_privilege('anon','public.order_dispatch_item(uuid,uuid,uuid,numeric,numeric,jsonb,text)','execute') then raise exception 'exposed'; end if;
end $$;
select 'order_item_changes ok';
rollback;
