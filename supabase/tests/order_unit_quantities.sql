-- Quantities for products priced per unit (20261114200000_order_unit_quantities.sql).
-- Run only in an isolated test database after all migrations; everything is rolled back.
begin;
create temp table ids as select gen_random_uuid() as business, gen_random_uuid() as owner, gen_random_uuid() as conversation,
  gen_random_uuid() as wood, gen_random_uuid() as chair, gen_random_uuid() as version;
insert into auth.users(id) select owner from ids;
insert into public.businesses(id,name,slug) select business,'Druri Test','druri-test-qty' from ids;
insert into public.business_users(business_id,user_id,role) select business,owner,'owner' from ids;
insert into public.conversations(id,business_id) select conversation,business from ids;
insert into public.products(id,business_id,name,price_amount,currency,is_active,price_unit) select wood,business,'Dërrasë pishe',1200,'ALL',true,'m³' from ids;
insert into public.products(id,business_id,name,price_amount,currency,is_active) select chair,business,'Karrige',2500,'ALL',true from ids;
-- A minimal published version; its publication guards are not under test here.
set local session_replication_role=replica;
insert into public.visual_workflow_versions(id,business_id,graph) select version,business,'{"version":2,"flows":[{"id":"order","productIds":[]}]}' from ids;
set local session_replication_role=origin;

create function pg_temp.manual(p_product uuid, q numeric, k text) returns uuid language sql as $$
 select public.create_manual_order(i.business,i.owner,i.conversation,p_product,q,'{"name":"Ana Test","phone":"+355690000000"}',null,k) from ids i
$$;
create function pg_temp.fails(sql text, code text) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then
  if sqlerrm<>code then raise exception 'expected % got %',code,sqlerrm; end if; return; end;
 raise exception 'expected % but it succeeded: %',code,sql;
end $$;

-- Manual: half a cubic metre of a unit-priced product; the total is computed here.
do $$ declare o uuid; begin
 o:=pg_temp.manual((select wood from ids),0.5,'qty-wood-half');
 if (select total_amount from public.orders where id=o)<>600 then raise exception 'manual total'; end if;
 if (select quantity from public.order_items where order_id=o)<>0.5 then raise exception 'manual item quantity'; end if;
 if (select payload->>'unit' from public.orders where id=o)<>'m³' then raise exception 'manual unit'; end if;
 if pg_temp.manual((select wood from ids),0.5,'qty-wood-half')<>o then raise exception 'manual idempotency'; end if;
 o:=pg_temp.manual((select wood from ids),1.333,'qty-wood-third');
 if (select total_amount from public.orders where id=o)<>1599.6 then raise exception 'manual rounding'; end if;
end $$;
select pg_temp.fails($$select pg_temp.manual((select wood from ids),0,'qty-zero-1')$$,'invalid_quantity');
select pg_temp.fails($$select pg_temp.manual((select wood from ids),-1,'qty-negative')$$,'invalid_quantity');
select pg_temp.fails($$select pg_temp.manual((select wood from ids),0.0005,'qty-too-fine')$$,'invalid_quantity');
select pg_temp.fails($$select pg_temp.manual((select wood from ids),100000.5,'qty-too-much')$$,'invalid_quantity');
select pg_temp.fails($$select pg_temp.manual((select wood from ids),'NaN','qty-nan-1')$$,'invalid_quantity');
-- A product without a unit keeps whole items 1–999.
do $$ declare o uuid; begin
 o:=pg_temp.manual((select chair from ids),3,'qty-chairs');
 if (select total_amount from public.orders where id=o)<>7500 then raise exception 'chair total'; end if;
end $$;
select pg_temp.fails($$select pg_temp.manual((select chair from ids),1.5,'qty-chair-half')$$,'invalid_quantity');
select pg_temp.fails($$select pg_temp.manual((select chair from ids),1000,'qty-chair-many')$$,'invalid_quantity');

-- The agent's reviewed order, submitted by the owner (awaiting_staff): the quantity comes from the review.
create function pg_temp.review(p_product uuid, p_name text, unit numeric, q jsonb, rev integer) returns uuid language plpgsql as $$
declare a uuid:=gen_random_uuid(); i ids;
begin
 select * into i from ids;
 insert into public.conversation_states(conversation_id,business_id,revision,collected) values(i.conversation,i.business,rev,jsonb_build_object(
  'schemaVersion',4,'mode','live','revision',rev,'offers','{}'::jsonb,'focusId',null,'businessId',i.business,'conversationId',i.conversation,'instances',jsonb_build_object('one',jsonb_build_object(
   'definitionId','order','versionId',i.version,'productWorkflow',jsonb_build_object('productId',p_product),
   'action',jsonb_build_object('id',a,'tool','order.create','toolVersion',1,'status','succeeded','output',jsonb_build_object('submissionStatus','awaiting_staff'),
    'approval',jsonb_build_object('waitId','w','expiresAt',(extract(epoch from now())*1000+600000)::bigint),'inputDigest','d',
    'input',jsonb_build_object('productId',p_product,'productName',p_name,'productTypeId','none','unitAmount',unit,'currency','ALL','quantity',q,
     'options','{}','name','Ana Test','phone','+355690000000','address','Rruga 1'))))))
 on conflict(conversation_id) do update set revision=excluded.revision,collected=excluded.collected;
 return a;
end $$;
create function pg_temp.submit(a uuid, rev integer) returns jsonb language sql as $$
 select public.submit_process_order(i.business,i.conversation,rev,a,i.owner,null,null) from ids i
$$;
do $$ declare a uuid; r jsonb; begin
 a:=pg_temp.review((select wood from ids),'Dërrasë pishe',1200,'0.75',1);
 r:=pg_temp.submit(a,1);
 if (r->>'totalAmount' is not null) or (r#>>'{payload,totalAmount}')::numeric<>900 or (r#>>'{payload,items,0,quantity}')::numeric<>0.75 then raise exception 'agent payload %',r; end if;
 if (select total_amount from public.orders where id=(r->>'orderId')::uuid)<>900 then raise exception 'agent total'; end if;
 if (select quantity from public.order_items where order_id=(r->>'orderId')::uuid)<>0.75 then raise exception 'agent item quantity'; end if;
 if (select payload->>'unit' from public.orders where id=(r->>'orderId')::uuid)<>'m³' then raise exception 'agent unit'; end if;
end $$;
select pg_temp.fails($$select pg_temp.submit(pg_temp.review((select wood from ids),'Dërrasë pishe',1200,'0',2),2)$$,'invalid_quantity');
select pg_temp.fails($$select pg_temp.submit(pg_temp.review((select wood from ids),'Dërrasë pishe',1200,'0.0001',3),3)$$,'invalid_quantity');
select pg_temp.fails($$select pg_temp.submit(pg_temp.review((select wood from ids),'Dërrasë pishe',1200,'"0.5"',4),4)$$,'commercial_terms_changed');
-- Without a unit the agent's order stays one item.
select pg_temp.fails($$select pg_temp.submit(pg_temp.review((select chair from ids),'Karrige',2500,'2',5),5)$$,'commercial_terms_changed');
do $$ declare r jsonb; begin
 r:=pg_temp.submit(pg_temp.review((select chair from ids),'Karrige',2500,'1',6),6);
 if (r#>>'{payload,totalAmount}')::numeric<>2500 or (r#>>'{payload,items,0,quantity}')::numeric<>1 then raise exception 'chair payload %',r; end if;
end $$;
-- Rows written outside these functions are still bounded.
select pg_temp.fails($$insert into public.order_items(order_id,quantity) select id,0 from public.orders limit 1$$,
 'new row for relation "order_items" violates check constraint "order_items_quantity_positive"');
select 'order_unit_quantities ok';
rollback;
