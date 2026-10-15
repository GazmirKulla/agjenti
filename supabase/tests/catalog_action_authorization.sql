-- Package A product.create boundary. Synthetic fixtures, all rolled back.
-- Run as test administrator in a disposable local *_w4_test database only.
begin;
do $$ begin
 if current_database() not like '%\_w4\_test' escape '\' or inet_server_addr() is not null
  or current_setting('listen_addresses')<>'' then raise exception 'Use an isolated Unix-socket test database'; end if;
end $$;

-- Invoke the public RPC with the actual server role, not the test administrator.
create function pg_temp.try_catalog_write(b uuid,u uuid,rev integer,mode text,items jsonb) returns text
language plpgsql as $$
begin
 perform public.save_products_with_visual_flow(b,u,rev,'order',mode,items);
 return 'allowed';
exception when raise_exception then return sqlerrm;
end $$;

do $$
declare
 b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid();
 staff uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); t uuid:=gen_random_uuid();
 p uuid; imported uuid; foreign_p uuid; g jsonb; items jsonb; mode text; result text;
 failures text[]:=array[]::text[]; before_graph jsonb; before_products jsonb;
begin
 insert into auth.users(id) values(u),(staff),(outsider);
 insert into public.businesses(id,name,slug) values(b,'Synthetic catalog authorization',b::text),(other_b,'Synthetic foreign catalog',other_b::text);
 insert into public.business_users(business_id,user_id,role) values(b,u,'owner'),(b,staff,'staff'),(other_b,outsider,'owner');
 insert into public.product_types(id,name,is_active) values(t,'Synthetic catalog type',true);
 g:='{"version":2,"name":"Synthetic","nodes":[{"id":"start","kind":"start","label":"Start","config":{},"position":{"x":0,"y":0}},{"id":"product","kind":"product","label":"Product","config":{},"position":{"x":1,"y":0}},{"id":"end","kind":"end","label":"End","config":{},"position":{"x":2,"y":0}}],"edges":[{"id":"a","source":"start","target":"product","port":"next"},{"id":"b","source":"product","target":"end","port":"next"}],"flows":[{"id":"order","kind":"order","label":"Order","entryNodeId":"product","nodeIds":["product"]}]}'::jsonb;
 perform public.save_visual_workflow(b,u,0,g,'draft');
 perform public.save_visual_workflow(other_b,outsider,0,g,'draft');
 items:=jsonb_build_array(jsonb_build_object('name','Synthetic catalog product','external_id','synthetic-import','price_amount',10,'currency','EUR','product_type_id',t,'is_active',false));

 -- This is the original regression: valid tenant/member/modules, but the action
 -- itself is disabled. Both modes MUST reject before changing product or draft.
 update public.platform_actions set enabled=false where key='product.create';
 foreach mode in array array['create','import'] loop
  execute 'set local role service_role';
  result:=pg_temp.try_catalog_write(b,u,(select revision from public.visual_workflows where business_id=b),mode,items);
  execute 'reset role';
  if result<>'action_denied' then failures:=array_append(failures,mode||' returned '||result); end if;
 end loop;
 if cardinality(failures)>0 then raise exception 'product.create bypass: %',array_to_string(failures,', '); end if;
 raise notice 'PASS: disabled global product.create rejects create and import';
 update public.platform_actions set enabled=true where key='product.create';

 -- Keep plan, tenant override and staff policy checks of the previous wrapper.
 for mode in select unnest(array['create','import']) loop
  update public.plan_actions set enabled=false where action_key='product.create';
  execute 'set local role service_role';
  result:=pg_temp.try_catalog_write(b,u,1,mode,items);
  execute 'reset role';
  if result<>'action_denied' then raise exception 'plan policy bypass: %',result; end if;
  update public.plan_actions set enabled=true where action_key='product.create';
  insert into public.business_actions(business_id,action_key,enabled) values(b,'product.create',false);
  execute 'set local role service_role';
  result:=pg_temp.try_catalog_write(b,u,1,mode,items);
  execute 'reset role';
  if result<>'action_denied' then raise exception 'tenant policy bypass: %',result; end if;
  delete from public.business_actions where business_id=b and action_key='product.create';
  insert into public.business_action_settings(business_id,action_key,staff_allowed) values(b,'product.create',false);
  execute 'set local role service_role';
  result:=pg_temp.try_catalog_write(b,staff,1,mode,items);
  execute 'reset role';
  if result<>'action_denied' then raise exception 'staff policy bypass: %',result; end if;
  delete from public.business_action_settings where business_id=b and action_key='product.create';
  execute 'set local role service_role';
  result:=pg_temp.try_catalog_write(b,outsider,1,mode,items);
  execute 'reset role';
  if result<>'unauthorized' then raise exception 'cross-tenant actor bypass: %',result; end if;
 end loop;
 delete from public.business_users where business_id=b and user_id=staff;
 execute 'set local role service_role';
 result:=pg_temp.try_catalog_write(b,staff,1,'create',items);
 execute 'reset role';
 if result<>'unauthorized' then raise exception 'revoked membership bypass: %',result; end if;
 if exists(select 1 from public.products where business_id=b) or (select revision from public.visual_workflows where business_id=b)<>1
  then raise exception 'denial changed products or draft'; end if;
 raise notice 'PASS: plan, tenant policy, staff permission, cross-tenant and revoked membership; no writes on denial';

 -- Authorized create can activate discovery before any published workflow.
 items:=jsonb_set(items,'{0,is_active}','true');
 execute 'set local role service_role';
 result:=pg_temp.try_catalog_write(b,u,1,'create',items);
 execute 'reset role';
 if result<>'allowed' then raise exception 'authorized create: %',result; end if;
 select id into p from public.products where business_id=b and external_id='synthetic-import';
 if not exists(select 1 from public.products where id=p and is_active) then raise exception 'catalog not active'; end if;
 items:=jsonb_set(items,'{0,external_id}','"synthetic-second-import"');
 execute 'set local role service_role';
 result:=pg_temp.try_catalog_write(b,u,2,'import',items);
 execute 'reset role';
 if result<>'allowed' then raise exception 'authorized import: %',result; end if;
 select id into imported from public.products where business_id=b and external_id='synthetic-second-import';
 if imported is null or (select is_active from public.products where id=imported) then raise exception 'import draft default changed'; end if;
 -- Import upsert must retain its action guard too, not only new-row inserts.
 select to_jsonb(w) into before_graph from public.visual_workflows w where business_id=b;
 select jsonb_agg(to_jsonb(product) order by product.id) into before_products from public.products product where business_id=b;
 update public.platform_actions set enabled=false where key='product.create';
 execute 'set local role service_role';
 result:=pg_temp.try_catalog_write(b,u,3,'import',jsonb_set(items,'{0,name}','"Must not change"'));
 execute 'reset role';
 if result<>'action_denied' or before_graph is distinct from (select to_jsonb(w) from public.visual_workflows w where business_id=b)
  or before_products is distinct from (select jsonb_agg(to_jsonb(product) order by product.id) from public.products product where business_id=b)
  then raise exception 'denied import upsert changed existing data: %',result; end if;

 -- Existing update/bind semantics are independent of the create permission.
 items:=jsonb_set(items,'{0,id}',to_jsonb(imported::text));
 execute 'set local role service_role';
 result:=pg_temp.try_catalog_write(b,u,3,'update',items);
 execute 'reset role';
 if result<>'allowed' or not (select is_active from public.products where id=imported) then raise exception 'catalog activation with create disabled: %',result; end if;
 execute 'set local role service_role';
 result:=pg_temp.try_catalog_write(b,u,4,'bind',jsonb_build_array(jsonb_build_object('id',p)));
 execute 'reset role';
 if result<>'allowed' then raise exception 'existing binding denied: %',result; end if;
 insert into public.products(business_id,name,is_active) values(other_b,'Foreign synthetic',false) returning id into foreign_p;
 execute 'set local role service_role';
 result:=pg_temp.try_catalog_write(b,u,5,'bind',jsonb_build_array(jsonb_build_object('id',foreign_p)));
 execute 'reset role';
 if result<>'foreign_product' then raise exception 'foreign product binding allowed: %',result; end if;
 if not exists(select 1 from public.visual_workflows where business_id=b and revision=5 and not enabled and published_version_id is null)
  or exists(select 1 from public.visual_workflow_versions where business_id=b)
  or exists(select 1 from public.orders where business_id=b)
  or exists(select 1 from public.order_submissions where business_id=b) then raise exception 'unexpected publication or action'; end if;
 raise notice 'PASS: authorized create/import, active catalog without publication, denied import upsert, update/bind compatibility, foreign binding, no order/dispatch';
end $$;
do $$ declare client text; routine regprocedure:='public.save_products_with_visual_flow(uuid,uuid,integer,text,text,jsonb)'::regprocedure;
begin
 if not exists(select 1 from pg_catalog.pg_proc where oid=routine and prosecdef
  and proconfig @> array['search_path=pg_catalog, pg_temp']) then raise exception 'unsafe RPC execution configuration'; end if;
 if not has_function_privilege('service_role',routine,'execute') then raise exception 'server execution lost'; end if;
 foreach client in array array['anon','authenticated'] loop
  if has_function_privilege(client,routine,'execute') then raise exception 'client RPC grant widened'; end if;
  execute format('set local role %I',client);
  begin
   perform public.save_products_with_visual_flow(null,null,0,'order','create','[]');
   raise exception 'direct client RPC allowed';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
 end loop;
 raise notice 'PASS: restricted SECURITY DEFINER search_path, service execute retained, anon/authenticated RPC calls denied';
end $$;
rollback;
