-- Real PostgreSQL, only a disposable local *_w4_test DB after S1. No external IO.
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/tenant_customer_integrity.sql
begin;
do $$ begin
  if current_database() not like '%\_w4\_test' escape '\' or inet_server_addr() is not null then
    raise exception 'Use a local disposable *_w4_test database';
  end if;
end $$;
\ir fixtures/order_readiness.sql
create function pg_temp.s1_reject(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = expected then return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE %, but statement succeeded: %', expected, statement;
end $$;
create temp table s1_fixture as select gen_random_uuid() a, gen_random_uuid() b, gen_random_uuid() actor,
  gen_random_uuid() own, gen_random_uuid() foreign_customer, gen_random_uuid() conversation,
  gen_random_uuid() product, null::jsonb state;
grant select on pg_temp.s1_fixture to authenticated, service_role;
do $$ declare f record; s jsonb; begin
  select * into f from pg_temp.s1_fixture;
  if not exists(select 1 from pg_constraint where conrelid='public.conversations'::regclass
    and conname='conversations_customer_id_fkey' and cardinality(conkey)=2
    and convalidated and not condeferrable and confdeltype='c') then
    raise exception 'Expected validated immediate composite FK with original cascade';
  end if;
  insert into auth.users(id) values(f.actor);
  insert into public.businesses(id,name,slug,dashboard_profile) values
    (f.a,'S1 own',f.a::text,'{"source":"manual","enabledModules":["products","orders","workflows"]}'),
    (f.b,'S1 other',f.b::text,null);
  -- Even an owner who can read/write BOTH businesses may not cross-link them.
  insert into public.business_users(business_id,user_id,role) values(f.a,f.actor,'owner'),(f.b,f.actor,'owner');
  insert into public.customers(id,business_id,display_name,whatsapp_user_id) values
    (f.own,f.a,'Own','s1-same-participant'),(f.foreign_customer,f.b,'Foreign','s1-same-participant');
  insert into public.conversations(id,business_id,channel,whatsapp_participant_id)
    values(f.conversation,f.a,'whatsapp','s1-same-participant');
  insert into public.products(id,business_id,name,price_amount,currency,is_active) values(f.product,f.a,'S1',10,'EUR',true);
  s:=jsonb_build_object('schemaVersion',3,'product_id',f.product,'step_key','order_ready','fields','{}'::jsonb,
    'customer',jsonb_build_object('id',f.foreign_customer,'name','Synthetic','phone','+355691234567','address','Synthetic'),
    'context',jsonb_build_object('execution',jsonb_build_object('factOwner','order','orderConfirmed',true,
      'orderTerms',jsonb_build_object('productId',f.product,'unitAmount',10,'currency','EUR','quantity',1),
      'orderReview',jsonb_build_object('id',gen_random_uuid(),'confirmed',true,'fieldKeys','[]'::jsonb,'expiresAt',4102444800000))));
  s:=pg_temp.pin_test_order(f.a,f.actor,s);
  insert into public.conversation_states(conversation_id,business_id,collected,revision) values(f.conversation,f.a,s,7);
  update pg_temp.s1_fixture set state=s;
  perform set_config('request.jwt.claim.sub',f.actor::text,true);
end $$;

set local role authenticated;
do $$ declare f record; begin
  select * into f from pg_temp.s1_fixture;
  update public.conversations set customer_id=f.own where id=f.conversation;
  if not found then raise exception 'Authorized update did not reach row'; end if;
  perform pg_temp.s1_reject(format('update public.conversations set customer_id=%L where id=%L',f.foreign_customer,f.conversation),'23503');
  perform pg_temp.s1_reject(format('insert into public.conversations(business_id,customer_id) values(%L,%L)',f.a,f.foreign_customer),'23503');
  perform pg_temp.s1_reject(format('update public.conversations set business_id=%L where id=%L',f.b,f.conversation),'23503');
  -- Avoid the independent participant-identity UNIQUE guard masking the FK.
  perform pg_temp.s1_reject(format('update public.customers set business_id=%L,whatsapp_user_id=null where id=%L',f.b,f.own),'23503');
  update public.conversations set customer_id=null where id=f.conversation;
  raise notice 'PASS S1 authenticated: same tenant, NULL, foreign insert/update and both-side tenant changes';
end $$;
reset role;
set local role service_role;
do $$ declare f record; receipt jsonb; again jsonb; begin
  select * into f from pg_temp.s1_fixture;
  perform pg_temp.s1_reject(format('update public.conversations set customer_id=%L where id=%L',f.foreign_customer,f.conversation),'23503');
  perform pg_temp.s1_reject('set local session_replication_role=replica','42501');
  -- Existing SECURITY DEFINER writer selects the correct tenant's customer even
  -- when participant IDs collide and the submitted JSON names a foreign UUID.
  receipt:=public.submit_confirmed_order(f.a,f.actor,f.conversation,7,f.state,f.state,false);
  if receipt->>'dispatch' is distinct from 'true'
    or (select customer_id from public.conversations where id=f.conversation) is distinct from f.own
    or (select customer_id from public.orders where id=(receipt->>'orderId')::uuid) is distinct from f.own then
    raise exception 'Privileged RPC customer isolation failed';
  end if;
  again:=public.submit_confirmed_order(f.a,f.actor,f.conversation,7,f.state,f.state,false);
  if again->>'dispatch' is distinct from 'false' or again->>'orderId' is distinct from receipt->>'orderId' then
    raise exception 'Order replay contract changed';
  end if;
  perform pg_temp.s1_reject(format('update public.customers set business_id=%L,whatsapp_user_id=null where id=%L',f.b,f.own),'23503');
  raise notice 'PASS S1 service role + actual SECURITY DEFINER order RPC + replay + parent mutation';
end $$;
reset role;
do $$ declare f record; c uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); begin
  select * into f from pg_temp.s1_fixture;
  insert into public.customers(id,business_id) values(customer,f.a);
  insert into public.conversations(id,business_id,customer_id) values(c,f.a,customer);
  insert into public.messages(business_id,conversation_id,direction,source,body) values(f.a,c,'inbound','customer','S1');
  delete from public.customers where id=customer;
  if exists(select 1 from public.conversations where id=c) or exists(select 1 from public.messages where conversation_id=c) then
    raise exception 'Customer delete cascade changed';
  end if;
  if exists(select 1 from public.conversations c join public.customers u on u.id=c.customer_id where c.business_id<>u.business_id) then
    raise exception 'Invalid tenant/customer relationship persisted';
  end if;
  if has_function_privilege('authenticated','public.submit_confirmed_order(uuid,uuid,uuid,integer,jsonb,jsonb,boolean)','execute') then
    raise exception 'Privileged RPC exposed to clients';
  end if;
  raise notice 'PASS S1 cascade, final inventory, RPC privileges';
end $$;
rollback;
