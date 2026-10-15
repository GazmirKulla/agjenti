-- W0-B, AFTER the migration, only in an isolated *_w4_test database.
-- Real SET ROLE checks; no mock grants and no production/customer fixtures.
begin;
\ir fixtures/order_readiness.sql
do $$ begin
  if current_database() not like '%\_w4\_test' escape '\' then
    raise exception 'Use an isolated database ending in _w4_test';
  end if;
end $$;
create temp table w0b_fixture as select gen_random_uuid() b,gen_random_uuid() other_b,
  gen_random_uuid() actor,gen_random_uuid() outsider,gen_random_uuid() c,
  gen_random_uuid() p,gen_random_uuid() legacy_order,gen_random_uuid() foreign_order,
  null::jsonb state,null::jsonb receipt;
grant select on pg_temp.w0b_fixture to anon,authenticated,service_role;
do $$ declare f record; s jsonb; begin
  select * into f from pg_temp.w0b_fixture;
  insert into auth.users(id,email) values(f.actor,f.actor||'@test.invalid'),(f.outsider,f.outsider||'@test.invalid');
  insert into public.businesses(id,name,slug,dashboard_profile) values
    (f.b,'W0-B','w0b-'||f.b,'{"source":"manual","enabledModules":["products","orders","workflows"]}'),
    (f.other_b,'W0-B foreign','w0b-'||f.other_b,null);
  insert into public.business_users(business_id,user_id,role) values(f.b,f.actor,'owner'),(f.other_b,f.outsider,'owner');
  insert into public.conversations(id,business_id) values(f.c,f.b);
  insert into public.products(id,business_id,name,price_amount,currency) values(f.p,f.b,'Synthetic',17,'EUR');
  insert into public.orders(id,business_id,status,total_amount,payload) values
    (f.legacy_order,f.b,'confirmed',17,'{"legacy":"preserve"}'),
    (f.foreign_order,f.other_b,'confirmed',17,'{"legacy":"foreign"}');
  insert into public.order_items(order_id,quantity,unit_amount) values(f.legacy_order,1,17),(f.foreign_order,1,17);
  s:=jsonb_build_object('schemaVersion',3,'product_id',f.p,'step_key','order_ready','fields','{}'::jsonb,
    'visual',jsonb_build_object('versionId','immutable-test-version'),
    'customer',jsonb_build_object('name','Test','phone','+355691234567','address','Test only'),
    'context',jsonb_build_object('execution',jsonb_build_object('factOwner','order','orderConfirmed',true,
      'orderTerms',jsonb_build_object('productId',f.p,'unitAmount',17,'currency','EUR','quantity',1),
      'orderReview',jsonb_build_object('id',gen_random_uuid(),'confirmed',true,'factsKey','server-test',
        'fieldKeys','[]'::jsonb,'expiresAt',4102444800000))));
  s:=pg_temp.pin_test_order(f.b,f.actor,s);
  update pg_temp.w0b_fixture set state=s;
  insert into public.conversation_states(conversation_id,business_id,collected,revision) values(f.c,f.b,s,7);
end $$;
set local role service_role;
do $$ declare f record; r jsonb; replay jsonb; blocked boolean:=false; begin
  select * into f from pg_temp.w0b_fixture;
  begin perform public.submit_confirmed_order(f.b,f.outsider,f.c,7,f.state,f.state,false);
  exception when others then if sqlerrm<>'unauthorized' then raise; end if; blocked:=true; end;
  if not blocked then raise exception 'Cross-tenant actor accepted'; end if;
  r:=public.submit_confirmed_order(f.b,f.actor,f.c,7,f.state,f.state,false);
  if r->>'dispatch'<>'true' then raise exception 'Authorized RPC failed'; end if;
  replay:=public.submit_confirmed_order(f.b,f.actor,f.c,7,f.state,f.state,false);
  if replay->>'orderId'<>r->>'orderId' or replay->>'dispatch'<>'false' then raise exception 'Replay not idempotent'; end if;
  perform public.finish_order_submission(f.b,(r->>'orderId')::uuid,(r->>'attemptId')::uuid,'local_only',null);
  perform set_config('w0b.receipt',r::text,true);
  raise notice 'PASS service-role submission/finalization/replay and cross-tenant actor rejection';
end $$;
reset role;
update pg_temp.w0b_fixture set receipt=current_setting('w0b.receipt')::jsonb;

create function pg_temp.check_order_client() returns void language plpgsql security invoker as $$
declare f record; statement text; denied boolean;
begin
  if current_user not in ('anon','authenticated') then raise exception 'Use a real client role'; end if;
  select * into f from pg_temp.w0b_fixture;
  if current_user='authenticated' then
    if (select count(*) from public.orders where business_id=f.b)<>2
      or (select count(*) from public.order_items)<>2
      or exists(select 1 from public.orders where business_id=f.other_b) then
      raise exception 'Required own-tenant reads or cross-tenant RLS broken';
    end if;
  elsif has_table_privilege(current_user,'public.orders','SELECT') then
    if exists(select 1 from public.orders) then raise exception 'Anonymous read leaked orders'; end if;
  end if;
  foreach statement in array array[
    format('insert into public.orders(business_id) values(%L)',f.b),
    format('update public.orders set total_amount=0 where id=%L',f.legacy_order),
    format('delete from public.orders where id=%L',f.legacy_order),
    'truncate public.orders',
    format('insert into public.order_items(order_id,quantity,unit_amount) values(%L,1,0)',f.legacy_order),
    format('update public.order_items set unit_amount=0 where order_id=%L',f.legacy_order),
    format('delete from public.order_items where order_id=%L',f.legacy_order),
    'truncate public.order_items',
    format('update public.orders set total_amount=0 where id=%L',f.receipt->>'orderId'),
    'select public.assert_order_actor(null,null)',
    'select 1 from public.order_submissions'
  ] loop
    denied:=false;
    begin execute statement; exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Client operation not permission-denied: %',statement; end if;
  end loop;
  raise notice 'PASS %: 11 direct write/TRUNCATE/RPC/ledger denials; read policy preserved',current_user;
end $$;
select set_config('request.jwt.claim.sub',actor::text,true) from pg_temp.w0b_fixture;
set local role authenticated;
select pg_temp.check_order_client();
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.check_order_client();
reset role;
-- The other tenant still sees its own legacy history, never the first tenant.
select set_config('request.jwt.claim.sub',outsider::text,true) from pg_temp.w0b_fixture;
set local role authenticated;
do $$ declare f record; begin
  select * into f from pg_temp.w0b_fixture;
  if (select count(*) from public.orders)<>1
    or not exists(select 1 from public.orders where id=f.foreign_order)
    or (select count(*) from public.order_items)<>1 then raise exception 'Foreign tenant isolation failed'; end if;
end $$;
reset role;
do $$ declare f record; begin
  select * into f from pg_temp.w0b_fixture;
  if (select payload from public.orders where id=f.legacy_order)<>'{"legacy":"preserve"}'::jsonb
    or (select total_amount from public.orders where id=f.legacy_order)<>17
    or (select count(*) from public.order_items where order_id=f.legacy_order)<>1
    or (select collected from public.conversation_states where conversation_id=f.c) is distinct from f.state
    or (select count(*) from public.order_submissions where business_id=f.b)<>1 then
    raise exception 'Legacy data, pinned state or W4 intent ledger changed';
  end if;
  raise notice 'PASS legacy history and pinned snapshot preserved; legacy client writes intentionally denied';
end $$;
rollback;
