-- Optional customer details per business (20261116200000_optional_customer_fields.sql).
-- Run only in an isolated test database after all migrations; everything is rolled back.
begin;
create temp table ids as select gen_random_uuid() as business, gen_random_uuid() as owner, gen_random_uuid() as conversation,
  gen_random_uuid() as product, gen_random_uuid() as ord;
insert into auth.users(id) select owner from ids;
insert into public.businesses(id,name,slug) select business,'Optional Test','optional-customer-test' from ids;
insert into public.business_users(business_id,user_id,role) select business,owner,'owner' from ids;
insert into public.conversations(id,business_id) select conversation,business from ids;
insert into public.products(id,business_id,name,price_amount,currency,is_active) select product,business,'Kuti',300,'ALL',true from ids;
insert into public.orders(id,business_id,status,payload) select ord,business,'confirmed','{"customer":{"name":"Bora","phone":"0691111111"}}' from ids;

create function pg_temp.fails(sql text, code text) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then
  if sqlerrm<>code then raise exception 'expected % got %',code,sqlerrm; end if; return; end;
 raise exception 'expected %',code;
end $$;

-- Default: the phone is required, as before.
do $$ declare i ids; begin
 select * into i from ids;
 if not customer_field_required(i.business,'phone') then raise exception 'default'; end if;
 perform pg_temp.fails(format('select create_manual_order_lines(%L,%L,%L,%L,%L,null,%L)',i.business,i.owner,i.conversation,
  jsonb_build_array(jsonb_build_object('productId',i.product,'quantity',1)),'{"name":"Bora"}','optional-1'),'customer_required');
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.ord,gen_random_uuid(),'{"customer":{"phone":null}}'),'customer_required');
end $$;

-- Optional phone: an order and a change without it; the name stays required.
do $$ declare i ids; o uuid; r jsonb; begin
 select * into i from ids;
 update businesses set optional_customer_fields=array['phone','city','address'] where id=i.business;
 o:=create_manual_order_lines(i.business,i.owner,i.conversation,jsonb_build_array(jsonb_build_object('productId',i.product,'quantity',1)),'{"name":"Bora"}',null,'optional-2');
 if (select payload#>>'{customer,phone}' from orders where id=o) is not null then raise exception 'phone'; end if;
 perform pg_temp.fails(format('select create_manual_order_lines(%L,%L,%L,%L,%L,null,%L)',i.business,i.owner,i.conversation,
  jsonb_build_array(jsonb_build_object('productId',i.product,'quantity',1)),'{"phone":"0691111111"}','optional-3'),'customer_required');
 r:=begin_order_change(i.business,i.owner,i.ord,gen_random_uuid(),'{"customer":{"phone":null}}');
 if r->>'status'<>'accepted' or (select payload#>>'{customer,phone}' from orders where id=i.ord) is not null then raise exception 'change %',r; end if;
 perform pg_temp.fails(format('select begin_order_change(%L,%L,%L,%L,%L)',i.business,i.owner,i.ord,gen_random_uuid(),'{"customer":{"name":null}}'),'customer_required');
end $$;

do $$ begin
 perform pg_temp.fails('update businesses set optional_customer_fields=array[''name''] where slug=''optional-customer-test''','new row for relation "businesses" violates check constraint "businesses_optional_customer_fields"');
 if has_function_privilege('authenticated','public.customer_field_required(uuid,text)','execute') then raise exception 'exposed'; end if;
end $$;
select 'optional_customer_fields ok';
rollback;
