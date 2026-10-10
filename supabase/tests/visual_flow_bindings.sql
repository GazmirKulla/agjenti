-- Run in an isolated database after visual_flow_bindings. Everything rolls back.
begin;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000003501','flow-bindings@example.test');
insert into businesses(id,name,slug) values('00000000-0000-4000-8000-000000003501','Flow bindings','flow-bindings-test'),('00000000-0000-4000-8000-000000003502','Other business','flow-bindings-other');
insert into business_users(business_id,user_id,role) values('00000000-0000-4000-8000-000000003501','00000000-0000-4000-8000-000000003501','owner');
insert into products(id,business_id,name,is_active) values('aaaaaaaa-0000-4000-8000-000000003501','00000000-0000-4000-8000-000000003501','Inactive product',false),('aaaaaaaa-0000-4000-8000-000000003502','00000000-0000-4000-8000-000000003502','Other product',false);
insert into booking_services(id,business_id,name,duration_minutes,is_active,booking_enabled) values('bbbbbbbb-0000-4000-8000-000000003501','00000000-0000-4000-8000-000000003501','Inactive non-booking service',30,false,false),('bbbbbbbb-0000-4000-8000-000000003502','00000000-0000-4000-8000-000000003502','Other service',30,false,false);
do $$ declare
 tenant uuid:='00000000-0000-4000-8000-000000003501'; old_version uuid; new_version uuid;
 graph jsonb:='{"version":2,"name":"Shared flow","nodes":[{"id":"start","kind":"start","label":"Start","position":{"x":0,"y":0},"config":{}},{"id":"info","kind":"knowledge","label":"Information","position":{"x":300,"y":0},"config":{}},{"id":"end","kind":"end","label":"End","position":{"x":600,"y":0},"config":{}},{"id":"support","kind":"handoff","label":"Support","position":{"x":300,"y":300},"config":{}}],"edges":[{"id":"start-end","source":"start","target":"end","port":"next"},{"id":"info-end","source":"info","target":"end","port":"next"}],"flows":[{"id":"info","kind":"information","label":"Information","entryNodeId":"info","nodeIds":["info"]},{"id":"support","kind":"support","label":"Support","entryNodeId":"support","nodeIds":["support"]}]}';
 bound jsonb; candidate jsonb; binding_key text; invalid_value jsonb; target text; op text;
begin
 bound:=jsonb_set(jsonb_set(graph,'{flows,0,productIds}','["aaaaaaaa-0000-4000-8000-000000003501"]'),'{flows,0,serviceIds}','["bbbbbbbb-0000-4000-8000-000000003501"]');
 if not valid_visual_graph(graph,true) or not valid_visual_graph(bound,true) then raise exception 'Valid shared visual flow rejected'; end if;
 foreach binding_key in array array['productIds','serviceIds'] loop
  for invalid_value in select value from jsonb_array_elements('[null,"id",{},[null],[1],["not-a-uuid"],["aaaaaaaa-0000-4000-8000-000000003501","AAAAAAAA-0000-4000-8000-000000003501"]]'::jsonb) loop
   candidate:=jsonb_set(graph,array['flows','0',binding_key],invalid_value);
   if valid_visual_graph(candidate,false) or valid_visual_graph(candidate,true) then raise exception 'Invalid binding accepted: % %',binding_key,invalid_value; end if;
  end loop;
  candidate:=jsonb_set(graph,array['flows','0',binding_key],(select jsonb_agg(md5(n::text)::uuid::text) from generate_series(1,201)n));
  if valid_visual_graph(candidate,false) then raise exception 'More than 200 bindings accepted'; end if;
  candidate:=jsonb_set(jsonb_set(graph,array['flows','0',binding_key],'["aaaaaaaa-0000-4000-8000-000000003501"]'),array['flows','1',binding_key],'["AAAAAAAA-0000-4000-8000-000000003501"]');
  if valid_visual_graph(candidate,false) or valid_visual_graph(candidate,true) then raise exception 'Ambiguous bindings across flows accepted'; end if;
 end loop;
 -- Inactive products and non-booking services can be drafted without activation.
 perform save_visual_workflow(tenant,tenant,0,bound,'draft');
 if (select enabled or published_version_id is not null from visual_workflows where business_id=tenant) then raise exception 'Draft unexpectedly activated'; end if;
 if (select draft from visual_workflows where business_id=tenant)<>bound then raise exception 'Bindings not saved'; end if;
 perform save_visual_workflow(tenant,tenant,1,bound,'publish');
 select published_version_id into old_version from visual_workflows where business_id=tenant;
 perform save_visual_workflow(tenant,tenant,2,graph,'draft');
 if (select published_version_id from visual_workflows where business_id=tenant)<>old_version then raise exception 'Draft changed published pointer'; end if;
 if (select v.graph from visual_workflow_versions v where id=old_version)<>bound then raise exception 'Draft changed immutable bindings'; end if;
 -- Ownership is rechecked atomically for both draft and publication; no partial write.
 foreach op in array array['draft','publish'] loop
  foreach binding_key in array array['productIds','serviceIds'] loop
   foreach target in array array['aaaaaaaa-0000-4000-8000-000000003502','bbbbbbbb-0000-4000-8000-000000003502','cccccccc-0000-4000-8000-000000003599'] loop
    candidate:=jsonb_set(graph,array['flows','0',binding_key],jsonb_build_array(target));
    begin
     perform save_visual_workflow(tenant,tenant,3,candidate,op);
     raise exception 'Missing/foreign binding accepted' using errcode='XX001';
    exception when raise_exception then if sqlerrm<>'invalid_workflow_targets' then raise; end if; end;
    if (select revision from visual_workflows where business_id=tenant)<>3 then raise exception 'Invalid save changed revision'; end if;
   end loop;
  end loop;
 end loop;
 begin perform save_visual_workflow(tenant,tenant,2,bound,'draft'); raise exception 'Stale save accepted' using errcode='XX001'; exception when raise_exception then if sqlerrm<>'stale_workflow' then raise; end if; end;
 -- Removing an assignment remains possible even if its old entity was deleted.
 perform save_visual_workflow(tenant,tenant,3,bound,'draft');
 delete from products where id='aaaaaaaa-0000-4000-8000-000000003501';
 delete from booking_services where id='bbbbbbbb-0000-4000-8000-000000003501';
 candidate:=jsonb_set(jsonb_set(bound,'{flows,0,productIds}','[]'),'{flows,0,serviceIds}','[]');
 perform save_visual_workflow(tenant,tenant,4,candidate,'publish');
 select published_version_id into new_version from visual_workflows where business_id=tenant;
 if new_version=old_version or (select v.graph from visual_workflow_versions v where id=old_version)<>bound then raise exception 'Older version changed during repair'; end if;
 if (select v.graph from visual_workflow_versions v where id=new_version)<>candidate then raise exception 'Removed bindings not published'; end if;
end $$;
rollback;
