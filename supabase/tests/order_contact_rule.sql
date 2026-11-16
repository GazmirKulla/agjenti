-- What a saved order writes to the customer record (20261116150000_order_contact_rule.sql).
-- Run only in an isolated test database after all migrations; everything is rolled back.
begin;
create temp table ids as select gen_random_uuid() as business, gen_random_uuid() as other_business, gen_random_uuid() as owner,
  gen_random_uuid() as conversation, gen_random_uuid() as customer, gen_random_uuid() as product;
insert into auth.users(id) select owner from ids;
insert into public.businesses(id,name,slug) select business,'Contact Test','contact-rule-test' from ids;
insert into public.businesses(id,name,slug) select other_business,'Other','contact-rule-other' from ids;
insert into public.business_users(business_id,user_id,role) select business,owner,'owner' from ids;
-- A customer whose number was typed in by hand earlier.
insert into public.customers(id,business_id,instagram_user_id,display_name,phone,updated_at)
 select customer,business,'ig-bora','Bora','0691111111',now()-interval '5 days' from ids;
insert into public.conversations(id,business_id,customer_id,instagram_participant_id) select conversation,business,customer,'ig-bora' from ids;
insert into public.products(id,business_id,name,price_amount,currency,is_active) select product,business,'Kuti',300,'ALL',true from ids;

-- The owner's order with the number the customer gave: the record takes the new number, keeps its name.
do $$ declare i ids; c public.customers; begin
 select * into i from ids;
 perform public.create_manual_order_lines(i.business,i.owner,i.conversation,
  jsonb_build_array(jsonb_build_object('productId',i.product,'quantity',1)),
  '{"name":"Motra e Borës","phone":"067 643 0393","city":"Tiranë","address":"Rr. Panajot Pano"}',null,'contact-rule-1');
 select * into c from public.customers where id=i.customer;
 if c.phone<>'067 643 0393' then raise exception 'phone not replaced: %',c.phone; end if;
 if c.display_name<>'Bora' then raise exception 'name overwritten: %',c.display_name; end if;
 if c.updated_at < now()-interval '1 minute' then raise exception 'updated_at not moved'; end if;
end $$;

-- An empty name is filled; a blank phone never clears a saved one.
do $$ declare i ids; c public.customers; before timestamptz; begin
 select * into i from ids;
 update public.customers set display_name=null where id=i.customer;
 perform public.apply_order_contact(i.business,i.customer,'Bora Mato','  ');
 select * into c from public.customers where id=i.customer;
 if c.display_name<>'Bora Mato' or c.phone<>'067 643 0393' then raise exception 'fill %',row_to_json(c); end if;
 -- Nothing to change: the record's time stays.
 select updated_at into before from public.customers where id=i.customer;
 perform public.apply_order_contact(i.business,i.customer,'Someone','067 643 0393');
 if (select updated_at from public.customers where id=i.customer)<>before then raise exception 'touched without change'; end if;
end $$;

-- Another business can never write to this customer.
do $$ declare i ids; begin
 select * into i from ids;
 perform public.apply_order_contact(i.other_business,i.customer,'X','0600000000');
 if (select phone from public.customers where id=i.customer)<>'067 643 0393' then raise exception 'cross-business write'; end if;
end $$;

-- Only the server may call it.
do $$ begin
 if has_function_privilege('authenticated','public.apply_order_contact(uuid,uuid,text,text)','execute')
  or has_function_privilege('anon','public.apply_order_contact(uuid,uuid,text,text)','execute') then raise exception 'exposed'; end if;
end $$;
select 'order_contact_rule ok';
rollback;
