-- Package A real SQL/RPC regression. Local disposable database only; all data rolls back.
begin;
do $$ begin
 if current_database() not like '%\_w4\_test' escape '\' or inet_server_addr() is not null
  then raise exception 'Use a local disposable *_w4_test database'; end if;
end $$;
\ir fixtures/order_readiness.sql
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then
  if sqlerrm=expected then return; end if;
  raise exception 'Expected %, got % for %',expected,sqlerrm,statement;
 end;
 raise exception 'Expected denial %, statement succeeded: %',expected,statement;
end $$;
create temp table readiness_fixture as select gen_random_uuid() b,gen_random_uuid() other_b,gen_random_uuid() u,gen_random_uuid() outsider,
 gen_random_uuid() p,gen_random_uuid() inactive,gen_random_uuid() foreign_p,gen_random_uuid() c,
 null::jsonb state,null::jsonb graph,null::uuid foreign_version;
grant select,update on pg_temp.readiness_fixture to service_role;
do $$ declare f record; s jsonb; begin
 select * into f from pg_temp.readiness_fixture;
 insert into auth.users(id) values(f.u),(f.outsider);
 insert into public.businesses(id,name,slug,dashboard_profile) values
  (f.b,'Synthetic SQL readiness',f.b::text,'{"source":"manual","enabledModules":["products","orders","workflows"]}'),
  (f.other_b,'Synthetic other tenant',f.other_b::text,null);
 insert into public.business_users(business_id,user_id,role) values(f.b,f.u,'owner'),(f.other_b,f.outsider,'owner');
 insert into public.products(id,business_id,name,price_amount,currency,is_active) values
  (f.p,f.b,'Active',10,'EUR',true),(f.inactive,f.b,'Inactive',10,'EUR',false),(f.foreign_p,f.other_b,'Foreign',10,'EUR',true);
 insert into public.conversations(id,business_id) values(f.c,f.b);
 s:=jsonb_build_object('schemaVersion',3,'product_id',f.p,'step_key','order_ready','fields','{}'::jsonb,
  'customer',jsonb_build_object('name','Synthetic','phone','+355691234567','address','Synthetic address'),
  'context',jsonb_build_object('execution',jsonb_build_object('factOwner','order','orderConfirmed',true,
   'orderTerms',jsonb_build_object('productId',f.p,'unitAmount',10,'currency','EUR','quantity',1),
   'orderReview',jsonb_build_object('id',gen_random_uuid(),'confirmed',true,'factsKey','no-workflow','fieldKeys','[]'::jsonb,'expiresAt',4102444800000))));
 insert into public.conversation_states(conversation_id,business_id,collected,revision) values(f.c,f.b,s,7);
 update pg_temp.readiness_fixture set state=s,graph=pg_temp.order_test_graph(f.p);
 perform public.save_visual_workflow(f.other_b,f.outsider,0,pg_temp.order_test_graph(f.foreign_p),'publish');
 update pg_temp.readiness_fixture set foreign_version=(select published_version_id from public.visual_workflows where business_id=f.other_b);
end $$;
create function pg_temp.denied_order(s jsonb,expected text, supplied jsonb default null) returns void language plpgsql as $$
declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 update public.conversation_states set collected=s,revision=7,status='ready' where conversation_id=f.c;
 perform pg_temp.expect_error(format('select public.submit_confirmed_order(%L,%L,%L,7,%L,%L,false)',f.b,f.u,f.c,s,coalesce(supplied,s)),expected);
 if exists(select 1 from public.orders where business_id=f.b) or exists(select 1 from public.order_submissions where business_id=f.b)
  or exists(select 1 from public.customers where business_id=f.b) then raise exception 'Denied request persisted side effects'; end if;
end $$;
create function pg_temp.allowed_order(s jsonb) returns void language plpgsql as $$
declare f record; r jsonb; again jsonb; begin
 select * into f from pg_temp.readiness_fixture;
 -- Roll back each successful test order, allowing independent negative cases.
 begin
  update public.conversation_states set collected=s,revision=7,status='ready' where conversation_id=f.c;
  r:=public.submit_confirmed_order(f.b,f.u,f.c,7,s,s,false);
  if r->>'dispatch' is distinct from 'true' or (select count(*) from public.orders where business_id=f.b)<>1
   or (select count(*) from public.order_items where order_id=(r->>'orderId')::uuid)<>1 then raise exception 'Missing atomic order/dispatch'; end if;
  if (select collected from public.conversation_states where conversation_id=f.c)<>s then raise exception 'Pinned state mutated'; end if;
  again:=public.submit_confirmed_order(f.b,f.u,f.c,7,s,s,false);
  if again->>'dispatch' is distinct from 'false' or again->>'orderId' is distinct from r->>'orderId' then raise exception 'Replay duplicated'; end if;
  raise exception 'rollback successful synthetic order' using errcode='P9999';
 exception when sqlstate 'P9999' then null; end;
end $$;
set local role service_role;
do $$ declare f record; rev integer; s jsonb; catalog jsonb; begin
 select * into f from pg_temp.readiness_fixture;
 perform pg_temp.denied_order(f.state,'workflow_not_ready');
 perform public.save_visual_workflow(f.b,f.u,0,pg_temp.order_test_graph(f.inactive),'draft');
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,1,%L,''publish'')',f.b,f.u,pg_temp.order_test_graph(f.inactive)),'invalid_workflow_targets');
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,1,%L,''publish'')',f.b,f.u,pg_temp.order_test_graph(f.foreign_p)),'invalid_workflow_targets');
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,1,%L,''publish'')',f.b,f.outsider,f.graph),'unauthorized');
 if (select revision from public.visual_workflows where business_id=f.b)<>1 or exists(select 1 from public.visual_workflow_versions where business_id=f.b)
  then raise exception 'Rejected publication altered draft/history'; end if;
 perform pg_temp.denied_order(jsonb_set(f.state,'{visual}','{"versionId":"preview:draft","nodeId":"end","visited":["product"]}'),'workflow_not_ready');
 s:=pg_temp.pin_test_order(f.b,f.u,f.state);
 update pg_temp.readiness_fixture set state=s;
 perform pg_temp.allowed_order(s);
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,1,%L,''publish'')',f.b,f.u,f.graph),'stale_workflow');
 -- A different published version must not rebase an active execution's old pin.
 perform public.save_visual_workflow(f.b,f.u,2,jsonb_set(f.graph,'{name}','"Republished"'),'publish');
 perform pg_temp.allowed_order(s);
 perform public.save_visual_workflow(f.b,f.u,3,jsonb_set(f.graph,'{nodes,1,label}','"Draft only"'),'draft');
 perform pg_temp.allowed_order(s);
 perform pg_temp.denied_order(jsonb_set(s,'{visual,versionId}','"simulation:test"'),'workflow_not_ready');
 perform pg_temp.denied_order(jsonb_set(s,'{visual,versionId}',to_jsonb(f.foreign_version)),'workflow_not_ready');
 perform pg_temp.denied_order(jsonb_set(s,'{visual,nodeId}','"missing"'),'workflow_not_ready');
 perform pg_temp.denied_order(jsonb_set(s,'{visual,visited}','["start","end"]'),'workflow_not_ready');
 perform pg_temp.denied_order(jsonb_set(s,'{visual,binding,entity,id}',to_jsonb(f.foreign_p)),'workflow_not_ready');
 perform pg_temp.denied_order(jsonb_set(s,'{visual,branchPorts}','{"product":"next"}'),'confirmation_required');
 perform pg_temp.denied_order(s,'workflow_not_ready',jsonb_set(s,'{visual,versionId}','"invented"'));
 perform pg_temp.denied_order(jsonb_set(s,'{context,execution,orderConfirmed}','false'),'confirmation_required');
 perform pg_temp.denied_order(jsonb_set(s,'{context,execution,orderReview,expiresAt}','1'),'confirmation_required');
 perform pg_temp.denied_order(jsonb_set(s,'{context,execution,orderReview,factsKey}',to_jsonb(
  jsonb_set((s#>>'{context,execution,orderReview,factsKey}')::jsonb,'{7,unitAmount}','999')::text)),'confirmation_required');
 -- A valid different pin without new confirmation still fails.
 perform pg_temp.denied_order(jsonb_set(s,'{visual,versionId}',to_jsonb((select published_version_id from public.visual_workflows where business_id=f.b))),'confirmation_required');
 -- Current pin can be republished, but explicit disable stops a new side effect.
 perform public.save_visual_workflow(f.b,f.u,4,null,'disable');
 perform pg_temp.denied_order(s,'workflow_not_ready');
 perform public.save_visual_workflow(f.b,f.u,5,null,'enable');
 perform pg_temp.allowed_order(s);
 update public.conversation_states set collected=s,revision=7 where conversation_id=f.c;
 perform pg_temp.expect_error(format('select public.submit_confirmed_order(%L,%L,%L,6,%L,%L,false)',f.b,f.u,f.c,s,s),'stale_state');
 raise notice 'PASS real service-role publication, inactive draft, invalid/foreign targets, pins, preview, stale confirmation/revision, disable and replay';
end $$;
reset role;
-- Entitlement and workspace selection are tested independently. No caller flag bypass.
-- Model an invalid historical version with the test administrator only; RPC callers
-- cannot update immutable versions. Restore the synthetic row immediately afterwards.
do $$ declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 update public.visual_workflow_versions set graph=jsonb_set(graph,'{edges}','[]')
  where business_id=f.b and id::text=f.state#>>'{visual,versionId}';
end $$;
set local role service_role;
do $$ begin perform pg_temp.denied_order((select state from pg_temp.readiness_fixture),'workflow_not_ready'); end $$;
reset role;
do $$ declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 update public.visual_workflow_versions set graph=f.graph where business_id=f.b and id::text=f.state#>>'{visual,versionId}';
end $$;
do $$ declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 insert into public.business_actions(business_id,action_key,enabled) values(f.b,'module.orders',false);
end $$;
set local role service_role;
do $$ declare f record; catalog jsonb; begin
 select * into f from pg_temp.readiness_fixture;
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,6,%L,''publish'')',f.b,f.u,f.graph),'module_disabled');
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,6,null,''enable'')',f.b,f.u),'module_disabled');
 -- Flow-kind alone requires Orders, even without a product node.
 catalog:=jsonb_set(f.graph,'{nodes,1,kind}','"knowledge"');
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,6,%L,''publish'')',f.b,f.u,catalog),'module_disabled');
 perform pg_temp.denied_order(f.state,'module_disabled');
 -- Order-status reads require Orders too, but not active catalog records.
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,6,%L,''publish'')',f.b,f.u,
  jsonb_set(jsonb_set(catalog,'{nodes,1,kind}','"order_status"'),'{flows,0,kind}','"information"')),'module_disabled');
 -- Catalog-only information is not order preparation.
 catalog:=jsonb_set(catalog,'{flows,0,kind}','"information"');
 perform public.save_visual_workflow(f.b,f.u,6,catalog,'publish');
 perform public.save_visual_workflow(f.b,f.u,7,null,'disable');
 -- Re-enabling an old order version must revalidate current readiness.
 raise notice 'PASS Orders OFF blocks order nodes/flows/submission; catalog-only publication remains valid';
end $$;
reset role;
do $$ declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 update public.business_actions set enabled=true where business_id=f.b;
 update public.businesses set dashboard_profile='{"source":"manual","enabledModules":["products","workflows"]}' where id=f.b;
end $$;
set local role service_role;
do $$ declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,8,%L,''publish'')',f.b,f.u,f.graph),'module_disabled');
 perform pg_temp.denied_order(f.state,'module_disabled');
end $$;
reset role;
-- Re-activation rechecks current modules and product state, not historical readiness.
do $$ declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 update public.businesses set dashboard_profile='{"source":"manual","enabledModules":["products","orders","workflows"]}' where id=f.b;
 perform public.save_visual_workflow(f.b,f.u,8,f.graph,'publish');
 perform public.save_visual_workflow(f.b,f.u,9,null,'disable');
 update public.business_actions set enabled=false where business_id=f.b and action_key='module.orders';
end $$;
set local role service_role;
do $$ declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,10,null,''enable'')',f.b,f.u),'module_disabled');
 if (select revision from public.visual_workflows where business_id=f.b)<>10 then raise exception 'Rejected enable changed revision'; end if;
end $$;
reset role;
do $$ declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 update public.business_actions set enabled=true where business_id=f.b;
 update public.products set is_active=false where id=f.p;
end $$;
set local role service_role;
do $$ declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,10,null,''enable'')',f.b,f.u),'invalid_workflow_targets');
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,10,%L,''publish'')',f.b,f.u,
  jsonb_set(f.graph,'{flows,0,productIds}','[]')),'active_products_required');
 perform pg_temp.denied_order(f.state,'product_unavailable');
end $$;
reset role;
do $$ declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 update public.products set is_active=true where id=f.p;
 insert into public.business_actions(business_id,action_key,enabled) values(f.b,'module.products',false);
end $$;
set local role service_role;
do $$ declare f record; info jsonb; begin
 select * into f from pg_temp.readiness_fixture;
 perform pg_temp.expect_error(format('select public.save_visual_workflow(%L,%L,10,%L,''publish'')',f.b,f.u,f.graph),'module_disabled');
 info:=jsonb_set(jsonb_set(jsonb_set(f.graph,'{nodes,1,kind}','"knowledge"'),'{flows,0,kind}','"information"'),'{flows,0,productIds}','[]');
 perform public.save_visual_workflow(f.b,f.u,10,info,'publish');
 raise notice 'PASS reactivation, product/module revocation, missing active catalog and unrelated information publication';
end $$;
reset role;
do $$ declare f record; begin
 select * into f from pg_temp.readiness_fixture;
 update public.business_actions set enabled=true where business_id=f.b;
end $$;
-- Legacy linear workflows are valid without any visual workspace.
do $$ declare f record; wid uuid:=gen_random_uuid(); v public.linear_workflow_versions; s jsonb; foreign_version uuid; begin
 select * into f from pg_temp.readiness_fixture;
 update public.businesses set dashboard_profile='{"source":"manual","enabledModules":["products","orders","workflows"]}' where id=f.b;
 insert into public.workflows(id,business_id,name) values(wid,f.b,'Synthetic legacy');
 insert into public.workflow_steps(workflow_id,key,kind,position,config) values(wid,'customer','customer',0,'{}');
 set constraints all immediate;
 update public.products set workflow_id=wid where id=f.p;
 delete from public.visual_workflows where business_id=f.b;
 select * into v from public.linear_workflow_versions where workflow_id=wid order by created_at desc limit 1;
 s:=jsonb_set(f.state-'visual','{context,execution,linear}',jsonb_build_object('id',wid,'versionId',v.id,'name',v.name,'steps',v.steps));
 s:=pg_temp.review_test_workflow(s);
 update pg_temp.readiness_fixture set state=s;
end $$;
set local role service_role;
do $$ declare f record; suspended jsonb; restored jsonb; begin
 select * into f from pg_temp.readiness_fixture;
 perform pg_temp.allowed_order(f.state);
 perform pg_temp.allowed_order(jsonb_set(f.state,'{schemaVersion}','2'));
 perform pg_temp.allowed_order(jsonb_set(f.state,'{schemaVersion}','1'));
 perform pg_temp.allowed_order((f.state #- '{context,execution,linear}') ||
  jsonb_build_object('linearSnapshot',f.state#>'{context,execution,linear}'));
 perform pg_temp.denied_order(jsonb_set(f.state,'{context,execution,linear,steps}','[]'),'workflow_not_ready');
 perform pg_temp.denied_order(jsonb_set(f.state,'{context,execution,linear,versionId}','"linear-preview:x"'),'workflow_not_ready');
 perform pg_temp.denied_order((f.state #- '{context,execution,linear}') || '{"orderWorkflowSnapshot":"opaque-unverifiable-token"}','workflow_not_ready');
 -- A suspended order is checked against its own stored execution, not booking facts.
 suspended:=jsonb_set(f.state,'{processes}',jsonb_build_object('active','booking','order',jsonb_build_object('status','suspended','snapshot',
  jsonb_build_object('product_id',f.p,'step_key','order_ready','execution',f.state#>'{context,execution}'))));
 suspended:=jsonb_set(suspended,'{context,execution}','{"factOwner":"booking"}');
 restored:=f.state;
 update public.conversation_states set collected=suspended,revision=7,status='ready' where conversation_id=f.c;
 begin
  if public.submit_confirmed_order(f.b,f.u,f.c,7,suspended,restored,false)->>'dispatch' is distinct from 'true' then raise exception 'Suspended order failed'; end if;
  raise exception 'rollback suspended order' using errcode='P9999';
 exception when sqlstate 'P9999' then null; end;
 raise notice 'PASS real linear version without visual dependency, stale/preview/sealed-only rejection and suspended process ownership';
end $$;
reset role;
do $$ declare routine record; begin
 for routine in select oid,proname,proconfig from pg_catalog.pg_proc where pronamespace='public'::regnamespace
  and proname in ('save_visual_workflow','submit_confirmed_order','guard_action_workflow_publication','assert_visual_catalog_readiness','assert_order_workflow_ready') loop
  if not coalesce(routine.proconfig @> array['search_path=pg_catalog, pg_temp'],false)
   or has_function_privilege('anon',routine.oid,'execute') or has_function_privilege('authenticated',routine.oid,'execute') then raise exception 'Unsafe ACL/search path: %',routine.proname; end if;
  if routine.proname like 'assert_%' and has_function_privilege('service_role',routine.oid,'execute') then raise exception 'Internal helper exposed'; end if;
 end loop;
 raise notice 'PASS hardened paths and unchanged client EXECUTE boundaries';
end $$;
rollback;
