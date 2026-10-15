-- Package A. Run ONLY after the proposed migration, in a disposable *_test DB.
-- Not executed as part of implementation: migration execution requires approval.
begin;
do $$
declare b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); p uuid; foreign_p uuid; g jsonb;
begin
 if current_database() not like '%\_test' escape '\' then raise exception 'Use an isolated database ending in _test'; end if;
 insert into public.businesses(id,name,slug) values(b,'Synthetic bootstrap',b::text),(other_b,'Synthetic foreign',other_b::text);
 insert into auth.users(id) values(u); insert into public.profiles(id) values(u) on conflict do nothing;
 insert into public.business_users(business_id,user_id,role) values(b,u,'owner');
 insert into public.product_types(id,name,is_active) values(t,'Synthetic type',true);
 g:='{"version":2,"name":"Synthetic","nodes":[{"id":"start","kind":"start","label":"Start","config":{},"position":{"x":0,"y":0}},{"id":"product","kind":"product","label":"Product","config":{},"position":{"x":1,"y":0}},{"id":"end","kind":"end","label":"End","config":{},"position":{"x":2,"y":0}}],"edges":[{"id":"a","source":"start","target":"product","port":"next"},{"id":"b","source":"product","target":"end","port":"next"}],"flows":[{"id":"order","kind":"order","label":"Order","entryNodeId":"product","nodeIds":["product"]}]}'::jsonb;
 perform public.save_visual_workflow(b,u,0,g,'draft');
 perform public.save_products_with_visual_flow(b,u,1,'order','create',jsonb_build_array(jsonb_build_object('name','Synthetic active','price_amount',10,'currency','EUR','product_type_id',t,'is_active',true)));
 select id into p from public.products where business_id=b and name='Synthetic active';
 if not exists(select 1 from public.products where id=p and is_active) then raise exception 'test_failed_catalog_activation'; end if;
 if not exists(select 1 from public.visual_workflows where business_id=b and revision=2 and not enabled and published_version_id is null and (draft->'flows'->0->'productIds') ? p::text)
 then raise exception 'test_failed_implicit_publication'; end if;
 begin
  perform public.save_products_with_visual_flow(b,u,2,'order','create','[{"name":"Invalid active","currency":"EUR","is_active":true}]');
  raise exception 'test_failed_invalid_catalog';
 exception when raise_exception then if sqlerrm<>'catalog_configuration_required' then raise; end if; end;
 if exists(select 1 from public.products where business_id=b and name='Invalid active') or (select revision from public.visual_workflows where business_id=b)<>2 then raise exception 'test_failed_atomicity'; end if;
 insert into public.products(business_id,name,is_active) values(other_b,'Foreign draft',false) returning id into foreign_p;
 begin
  perform public.save_products_with_visual_flow(b,u,2,'order','bind',jsonb_build_array(jsonb_build_object('id',foreign_p)));
  raise exception 'test_failed_foreign_binding';
 exception when raise_exception then if sqlerrm<>'foreign_product' then raise; end if; end;
 delete from public.business_users where business_id=b and user_id=u;
 begin
  perform public.save_products_with_visual_flow(b,u,2,'order','bind',jsonb_build_array(jsonb_build_object('id',p)));
  raise exception 'test_failed_revoked_actor';
 exception when raise_exception then if sqlerrm<>'unauthorized' then raise; end if; end;
 if has_function_privilege('anon','public.save_products_with_visual_flow(uuid,uuid,integer,text,text,jsonb)','execute') or
    has_function_privilege('authenticated','public.save_products_with_visual_flow(uuid,uuid,integer,text,text,jsonb)','execute') then raise exception 'test_failed_rpc_grants'; end if;
 raise notice 'PASS: catalog before publication, draft separation, atomic failure, tenant/actor guards and RPC grants';
end $$;
rollback;
