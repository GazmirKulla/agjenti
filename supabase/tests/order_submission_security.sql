-- W4-SEC. ONLY in a disposable *_w4_test database, as its test administrator.
-- Run with psql -X -v ON_ERROR_STOP=1 -f ... . All fixtures/ACL changes roll back.
-- Models TEMP + legacy DML privileges; NOT evidence of hosted Supabase grants.
begin;
\ir fixtures/order_readiness.sql
do $$ begin
  if current_database() not like '%\_w4\_test' escape '\' then
    raise exception 'Use an isolated database ending in _w4_test';
  end if;
end $$;
create temp table w4sec_fixture as select gen_random_uuid() b, gen_random_uuid() actor,
  gen_random_uuid() outsider, gen_random_uuid() c, gen_random_uuid() p,
  null::jsonb state, null::jsonb receipt;
grant select on pg_temp.w4sec_fixture to authenticated,service_role;
-- Deliberately exercise the vulnerable privilege combination, even on a local
-- bootstrap with SELECT-only grants. Do not deploy these grants.
grant select,insert,update,delete on public.orders,public.order_items to authenticated;
do $$ begin
  execute format('grant temporary on database %I to authenticated',current_database());
end $$;
do $$ declare f record; s jsonb; begin
  select * into f from pg_temp.w4sec_fixture;
  insert into auth.users(id,email) values(f.actor,f.actor||'@test.invalid'),(f.outsider,f.outsider||'@test.invalid');
  insert into public.businesses(id,name,slug,dashboard_profile) values(f.b,'W4 security','w4sec-'||f.b,
    '{"source":"manual","version":1,"enabledModules":["orders","products","workflows"]}');
  insert into public.business_users(business_id,user_id,role) values(f.b,f.actor,'owner');
  insert into public.products(id,business_id,name,price_amount,currency) values(f.p,f.b,'Test',12.75,'EUR');
  insert into public.conversations(id,business_id) values(f.c,f.b);
  s:=jsonb_build_object('schemaVersion',3,'product_id',f.p,'step_key','order_ready','fields','{}'::jsonb,
    'customer',jsonb_build_object('name','Test','phone','+355691234567','address','Test only'),
    'context',jsonb_build_object('execution',jsonb_build_object('factOwner','order','orderConfirmed',true,
      'orderTerms',jsonb_build_object('productId',f.p,'unitAmount',12.75,'currency','EUR','quantity',1),
      'orderReview',jsonb_build_object('id',gen_random_uuid(),'confirmed',true,'factsKey','server-test',
        'fieldKeys','[]'::jsonb,'expiresAt',4102444800000))));
  s:=pg_temp.pin_test_order(f.b,f.actor,s);
  insert into public.conversation_states(conversation_id,business_id,collected,revision) values(f.c,f.b,s,7);
  update pg_temp.w4sec_fixture set state=s,receipt=public.submit_confirmed_order(f.b,f.actor,f.c,7,s,s,false);
end $$;
select set_config('request.jwt.claim.sub',actor::text,true) from pg_temp.w4sec_fixture;
set local role authenticated;
-- First prove RLS permits reaching the target and the ordinary guard is active.
do $$ declare f record; blocked boolean:=false; begin
  select * into f from pg_temp.w4sec_fixture;
  if (select count(*) from public.orders where id=(f.receipt->>'orderId')::uuid)<>1 then
    raise exception 'Fixture is not visible under authenticated RLS';
  end if;
  begin update public.orders set total_amount=0 where id=(f.receipt->>'orderId')::uuid;
  exception when others then if sqlerrm<>'managed_order_immutable' then raise; end if; blocked:=true; end;
  if not blocked then raise exception 'Ordinary managed order guard absent'; end if;
end $$;
-- Original exploit: implicit pg_temp lookup precedes SET search_path=public.
create temp table order_submissions(order_id uuid);
-- Ensure a warmed plan cannot accidentally hide the original vulnerability.
discard plans;
do $$ declare f record; statement text; blocked boolean; begin
  select * into f from pg_temp.w4sec_fixture;
  foreach statement in array array[
    format('update public.orders set total_amount=0 where id=%L',f.receipt->>'orderId'),
    format('delete from public.orders where id=%L',f.receipt->>'orderId'),
    format('update public.order_items set unit_amount=0 where order_id=%L',f.receipt->>'orderId'),
    format('delete from public.order_items where order_id=%L',f.receipt->>'orderId'),
    format('insert into public.order_items(order_id,quantity,unit_amount) values(%L,1,0)',f.receipt->>'orderId')
  ] loop
    blocked:=false;
    begin execute statement;
    exception when others then if sqlerrm<>'managed_order_immutable' then raise; end if; blocked:=true; end;
    if not blocked then raise exception 'W4SEC_SHADOW_BYPASS: managed write succeeded with temporary ledger'; end if;
  end loop;
  raise notice 'PASS temporary ledger cannot bypass managed order/item guards (5 writes)';
end $$;
-- Poison relation AND composite-type names used by all W4 functions. Forged
-- membership must not authorize an outsider; remaining tables have wrong shapes.
create temp table platform_admins(user_id uuid);
create temp table business_users(business_id uuid,user_id uuid);
insert into pg_temp.platform_admins select outsider from pg_temp.w4sec_fixture;
insert into pg_temp.business_users select b,outsider from pg_temp.w4sec_fixture;
create temp table conversations(poison text);
create temp table conversation_states(poison text);
create temp table businesses(poison text);
create temp table products(poison text);
create temp table product_types(poison text);
create temp table customers(poison text);
create temp table orders(poison text);
create temp table order_items(poison text);
discard plans;
reset role;
-- A second confirmed intent tests fresh persistence, not just the replay branch.
update pg_temp.w4sec_fixture set state=jsonb_set(state,'{context,execution,orderReview,id}',to_jsonb(gen_random_uuid()));
update public.conversation_states s set collected=f.state,revision=9,status='ready'
  from pg_temp.w4sec_fixture f where s.conversation_id=f.c;
set local role service_role;
do $$ declare f record; r jsonb; replay jsonb; blocked boolean:=false; begin
  select * into f from pg_temp.w4sec_fixture;
  begin perform public.assert_order_actor(f.b,f.outsider);
  exception when others then if sqlerrm<>'unauthorized' then raise; end if; blocked:=true; end;
  if not blocked then raise exception 'Temporary membership authorized outsider'; end if;
  perform public.assert_order_actor(f.b,f.actor);
  r:=public.submit_confirmed_order(f.b,f.actor,f.c,9,f.state,f.state,false);
  if r->>'dispatch'<>'true' or r#>>'{payload,currency}'<>'EUR'
    or (r#>>'{payload,totalAmount}')::numeric<>12.75 then raise exception 'Fresh service RPC used shadow data'; end if;
  perform public.finish_order_submission(f.b,(r->>'orderId')::uuid,(r->>'attemptId')::uuid,'pending_reconciliation',null);
  replay:=public.submit_confirmed_order(f.b,f.actor,f.c,9,f.state,f.state,false);
  if replay->>'orderId'<>r->>'orderId' or replay->>'dispatch'<>'false'
    or replay->>'status'<>'pending_reconciliation' then raise exception 'Unknown outcome replay dispatched'; end if;
  perform set_config('w4sec.receipt',r::text,true);
  raise notice 'PASS forged membership rejected; real service RPC, authoritative terms and UNKNOWN replay with shadow tables';
end $$;
reset role;
update pg_temp.w4sec_fixture set receipt=current_setting('w4sec.receipt')::jsonb;
update public.order_submissions set created_at=now()-interval '2 minutes'
  where order_id=(current_setting('w4sec.receipt')::jsonb->>'orderId')::uuid;
set local role service_role;
do $$ declare f record; r jsonb; begin
  select * into f from pg_temp.w4sec_fixture;
  r:=public.reconcile_order_submission(f.b,f.actor,f.c,(f.receipt->>'orderId')::uuid,
    'accepted','test-provider-ref','Verified synthetic provider evidence');
  if r->>'status'<>'accepted' or r->>'dispatch'<>'false' then raise exception 'Reconciliation failed'; end if;
end $$;
reset role;
do $$ declare f record; routine record; client text; routine_count integer:=0; begin
  select * into f from pg_temp.w4sec_fixture;
  if (select total_amount from public.orders where id=(f.receipt->>'orderId')::uuid)<>12.75
    or (select status from public.orders where id=(f.receipt->>'orderId')::uuid)<>'submitted'
    or (select reconciled_by from public.order_submissions where order_id=(f.receipt->>'orderId')::uuid)<>f.actor
    or (select count(*) from public.orders where business_id=f.b)<>2
    or (select count(*) from public.order_items i join public.orders o on o.id=i.order_id where o.business_id=f.b)<>2
    then raise exception 'Real tables not correctly persisted/reconciled'; end if;
  for routine in select oid,proname,prosecdef,proconfig from pg_catalog.pg_proc
    where pronamespace='public'::regnamespace and proname in
      ('protect_managed_order','assert_order_actor','submit_confirmed_order','finish_order_submission','reconcile_order_submission')
  loop
    routine_count:=routine_count+1;
    if not routine.prosecdef or not coalesce(routine.proconfig @> array['search_path=pg_catalog, pg_temp'],false)
      then raise exception 'Unsafe function path: %',routine.proname; end if;
    foreach client in array array['anon','authenticated'] loop
      if has_function_privilege(client,routine.oid,'execute') then raise exception 'Client RPC exposed: %',routine.proname; end if;
    end loop;
    if routine.proname<>'protect_managed_order' and not has_function_privilege('service_role',routine.oid,'execute')
      then raise exception 'Service execution lost: %',routine.proname; end if;
  end loop;
  if routine_count<>5 then raise exception 'Expected exactly five W4 functions'; end if;
  raise notice 'PASS real reconciliation + safe function paths + RPC ACLs';
end $$;
set local role authenticated;
do $$ declare blocked boolean:=false; begin
  begin perform public.assert_order_actor(null,null);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Authenticated RPC execution allowed'; end if;
  blocked:=false;
  begin perform 1 from public.order_submissions;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Authenticated ledger access allowed'; end if;
end $$;
-- Compatibility/exposure diagnostic: a RAW legacy insert still bypasses the W4
-- intent ledger if these DML grants exist. This is NOT a security-gate PASS.
do $$ declare f record; legacy_id uuid; begin
  select * into f from pg_temp.w4sec_fixture;
  insert into public.orders(business_id,conversation_id,status,payload)
    values(f.b,f.c,'confirmed',f.state) returning id into legacy_id;
  update public.orders set total_amount=1 where id=legacy_id;
  delete from public.orders where id=legacy_id;
  raise notice 'LEGACY EXPOSURE (modeled grants): raw INSERT is outside W4 intent uniqueness; legacy CRUD unchanged';
end $$;
reset role;
set local role anon;
do $$ declare blocked boolean:=false; begin
  begin perform public.assert_order_actor(null,null);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Anon RPC execution allowed'; end if;
end $$;
reset role;
rollback;
