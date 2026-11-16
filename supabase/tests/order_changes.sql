-- Changing an existing order (20261116180000_order_changes.sql).
-- Run only in an isolated test database after all migrations; everything is rolled back.
begin;
create temp table ids as select gen_random_uuid() as business, gen_random_uuid() as other, gen_random_uuid() as owner, gen_random_uuid() as stranger,
  gen_random_uuid() as customer, gen_random_uuid() as local_order, gen_random_uuid() as web_order;
insert into auth.users(id) select owner from ids;
insert into auth.users(id) select stranger from ids;
insert into public.businesses(id,name,slug) select business,'Change Test','order-change-test' from ids;
insert into public.businesses(id,name,slug) select other,'Other','order-change-other' from ids;
insert into public.business_users(business_id,user_id,role) select business,owner,'owner' from ids;
insert into public.customers(id,business_id,display_name,phone) select customer,business,'Bora','0691111111' from ids;
insert into public.orders(id,business_id,customer_id,status,payload) select local_order,business,customer,'confirmed',
  '{"customer":{"name":"Bora","phone":"0691111111","city":"Tiranë","address":"Rr. e vjetër"},"note":null}' from ids;
insert into public.orders(id,business_id,customer_id,status,external_system,external_order_id,payload) select web_order,business,customer,'submitted','external','ord_1',
  '{"customer":{"name":"Bora","phone":"0691111111","city":"Tiranë","address":"Rr. e vjetër"},"note":"Ngjyra blu"}' from ids;

create function pg_temp.fails(sql text, code text) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then
  if sqlerrm<>code then raise exception 'expected % got %',code,sqlerrm; end if; return; end;
 raise exception 'expected %',code;
end $$;

-- A local order changes at once: the payload, the history and the customer's phone.
do $$ declare i ids; r jsonb; o orders; begin
 select * into i from ids;
 r:=begin_order_change(i.business,i.owner,i.local_order,'40000000-0000-4000-8000-000000000001','{"customer":{"address":" Rr. Panajot Pano ","phone":"067 643 0393"},"note":"Para orës 5"}');
 if r->>'status'<>'accepted' or (r->>'send')::boolean then raise exception 'local %',r; end if;
 select * into o from orders where id=i.local_order;
 if o.payload#>>'{customer,address}'<>'Rr. Panajot Pano' or o.payload#>>'{customer,name}'<>'Bora' or o.payload->>'note'<>'Para orës 5' then raise exception 'payload %',o.payload; end if;
 if r#>>'{before,customer,address}'<>'Rr. e vjetër' then raise exception 'before %',r; end if;
 if (select phone from customers where id=i.customer)<>'067 643 0393' then raise exception 'contact'; end if;
 -- The same request again returns the same change and changes nothing.
 r:=begin_order_change(i.business,i.owner,i.local_order,'40000000-0000-4000-8000-000000000001','{"note":"tjetër"}');
 if r->>'status'<>'accepted' or (r->>'send')::boolean or (select payload->>'note' from orders where id=i.local_order)<>'Para orës 5' then raise exception 'replay %',r; end if;
end $$;

-- A website order waits for the website; one open change at a time; accepted applies, refused does not.
do $$ declare i ids; r jsonb; begin
 select * into i from ids;
 r:=begin_order_change(i.business,i.owner,i.web_order,'40000000-0000-4000-8000-000000000002','{"customer":{"city":"Durrës"}}');
 if r->>'status'<>'pending' or not (r->>'send')::boolean or r->>'externalOrderId'<>'ord_1' then raise exception 'pending %',r; end if;
 if (select payload#>>'{customer,city}' from orders where id=i.web_order)<>'Tiranë' then raise exception 'applied before the website'; end if;
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.web_order,'40000000-0000-4000-8000-000000000003','{"note":"x"}'),'change_in_progress');
 -- Unclear: the same id is handed back for sending again.
 perform finish_order_change(i.business,'40000000-0000-4000-8000-000000000002','uncertain');
 r:=begin_order_change(i.business,i.owner,i.web_order,'40000000-0000-4000-8000-000000000002','{"customer":{"city":"Durrës"}}');
 if r->>'status'<>'pending' or not (r->>'send')::boolean then raise exception 'resend %',r; end if;
 r:=finish_order_change(i.business,'40000000-0000-4000-8000-000000000002','accepted');
 if r->>'status'<>'accepted' or (select payload#>>'{customer,city}' from orders where id=i.web_order)<>'Durrës' then raise exception 'accepted %',r; end if;
 -- A settled change never moves again.
 r:=finish_order_change(i.business,'40000000-0000-4000-8000-000000000002','rejected','late');
 if r->>'status'<>'accepted' then raise exception 'moved %',r; end if;
 r:=begin_order_change(i.business,i.owner,i.web_order,'40000000-0000-4000-8000-000000000004','{"note":null}');
 perform finish_order_change(i.business,'40000000-0000-4000-8000-000000000004','rejected','not_editable');
 if (select payload->>'note' from orders where id=i.web_order)<>'Ngjyra blu' then raise exception 'refused applied'; end if;
end $$;

-- Refusals: values, membership, another business, nothing to change, an unsettled order.
do $$ declare i ids; begin
 select * into i from ids;
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.local_order,gen_random_uuid(),'{"customer":{"phone":""}}'),'customer_required');
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.local_order,gen_random_uuid(),'{"customer":{"email":"a@b.c"}}'),'invalid_change');
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.local_order,gen_random_uuid(),'{"status":"cancelled"}'),'invalid_change');
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.local_order,gen_random_uuid(),'{"note":"Para orës 5"}'),'no_change');
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.stranger,i.local_order,gen_random_uuid(),'{"note":"x"}'),'unauthorized');
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.other,i.owner,i.local_order,gen_random_uuid(),'{"note":"x"}'),'unauthorized');
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.local_order,'40000000-0000-4000-8000-000000000002','{"note":"x"}'),'change_conflict');
 update orders set status='pending_reconciliation' where id=i.local_order;
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.local_order,gen_random_uuid(),'{"note":"x"}'),'order_unsettled');
end $$;

do $$ begin
 if has_function_privilege('authenticated','public.begin_order_change(uuid,uuid,uuid,uuid,jsonb)','execute')
  or has_function_privilege('anon','public.finish_order_change(uuid,uuid,text,text)','execute')
  or has_table_privilege('authenticated','public.order_changes','select') then raise exception 'exposed'; end if;
end $$;
select 'order_changes ok';
rollback;
