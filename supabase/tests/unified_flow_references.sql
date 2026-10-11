-- Run against a disposable migrated database; all fixtures roll back.
begin;
do $$
declare b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); p uuid; v uuid; g jsonb; count_before integer;
begin
 insert into businesses(id,name,slug) values(b,'Flow test',b::text),(other_b,'Other test',other_b::text);
 insert into auth.users(id) values(u); insert into profiles(id) values(u) on conflict do nothing;
 insert into business_users(business_id,user_id,role) values(b,u,'owner');
 g:='{"version":2,"name":"Business","nodes":[{"id":"start","kind":"start","label":"Start","config":{},"position":{"x":0,"y":0}},{"id":"info","kind":"knowledge","label":"Info","config":{},"position":{"x":0,"y":0}},{"id":"end","kind":"end","label":"End","config":{},"position":{"x":0,"y":0}}],"edges":[{"id":"a","source":"start","target":"info","port":"next"},{"id":"b","source":"info","target":"end","port":"next"}],"flows":[{"id":"information","kind":"information","label":"Information","entryNodeId":"info","nodeIds":["info"]}]}'::jsonb;
 perform save_visual_workflow(b,u,0,g,'draft');
 insert into agent_training_memories(business_id,kind,instruction,visual_flow_id,visual_node_id) values(b,'workflow','Explain info','information','info');
 begin
  insert into agent_training_memories(business_id,kind,instruction,visual_flow_id) values(other_b,'workflow','Do not leak','information');
  raise exception 'test_failed_cross_tenant_training';
 exception when raise_exception then if sqlerrm<>'training_visual_scope_missing' then raise; end if; end;
 begin
  insert into agent_training_memories(business_id,kind,instruction,visual_flow_id,visual_node_id) values(b,'workflow','Wrong step','information','missing');
  raise exception 'test_failed_wrong_step';
 exception when raise_exception then if sqlerrm<>'training_visual_scope_missing' then raise; end if; end;
 perform save_products_with_visual_flow(b,u,1,'information','create','[{"name":"Test A","sku":"TEST-A","price_amount":790,"currency":"ALL"}]');
 select id into p from products where business_id=b and sku='TEST-A';
 if not exists(select 1 from visual_workflows where business_id=b and revision=2 and not enabled and published_version_id is null and (draft->'flows'->0->'productIds') ? p::text) then raise exception 'test_failed_draft_binding'; end if;
 begin
  perform save_products_with_visual_flow(b,u,1,'information','create','[{"name":"Stale","sku":"STALE","currency":"ALL"}]');
  raise exception 'test_failed_stale';
 exception when raise_exception then if sqlerrm<>'stale_workflow' then raise; end if; end;
 begin
  perform save_products_with_visual_flow(b,u,2,'information','import','[{"name":"Should rollback","sku":"ROLLBACK","currency":"ALL"},{"name":"Duplicate","sku":"TEST-A","currency":"ALL"}]');
  raise exception 'test_failed_duplicate';
 exception when unique_violation then null; end;
 if exists(select 1 from products where sku in ('ROLLBACK','STALE')) or (select revision from visual_workflows where business_id=b)<>2 then raise exception 'test_failed_atomicity'; end if;
 insert into products(business_id,name) values(other_b,'Other product') returning id into v;
 begin
  perform save_products_with_visual_flow(b,u,2,'information','bind',jsonb_build_array(jsonb_build_object('id',v)));
  raise exception 'test_failed_foreign_product';
 exception when raise_exception then if sqlerrm<>'foreign_product' then raise; end if; end;
 begin
  perform save_products_with_visual_flow(b,u,2,'information','create','[{"name":"Premature active","sku":"ACTIVE","currency":"ALL","is_active":true}]');
  raise exception 'test_failed_premature_activation';
 exception when raise_exception then if sqlerrm<>'activation_requires_published' then raise; end if; end;
 if exists(select 1 from products where sku='ACTIVE') then raise exception 'test_failed_activation_rollback'; end if;
 select draft into g from visual_workflows where business_id=b;
 perform save_visual_workflow(b,u,2,g,'publish');
 select published_version_id into v from visual_workflows where business_id=b;
 perform save_products_with_visual_flow(b,u,3,'information','import','[{"name":"Imported","sku":"IMPORTED","external_id":"ext1","currency":"ALL"}]');
 if (select published_version_id from visual_workflows where business_id=b)<>v or exists(select 1 from visual_workflow_versions where id=v and (graph->'flows'->0->'productIds') ? (select id::text from products where business_id=b and sku='IMPORTED')) then raise exception 'test_failed_implicit_publication'; end if;
 perform save_products_with_visual_flow(b,u,4,'information','import','[{"name":"Imported updated","sku":"IMPORTED","external_id":"ext1","currency":"ALL"}]');
 if (select count(*) from products where business_id=b and external_id='ext1')<>1 then raise exception 'test_failed_import_update'; end if;
 raise notice 'PASS: visual memory scopes, tenant isolation, atomic products/imports, revisions, activation and publication boundaries';
end $$;
rollback;
