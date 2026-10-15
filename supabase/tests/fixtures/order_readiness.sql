-- Synthetic fixtures only, within the caller's disposable test transaction.
-- Do not call in an application database. No readiness flags or guard bypasses.
create function pg_temp.order_test_graph(product uuid) returns jsonb language sql as $$
 select jsonb_set('{"version":2,"name":"Synthetic order","nodes":[{"id":"start","kind":"start","label":"Start","config":{},"position":{"x":0,"y":0}},{"id":"product","kind":"product","label":"Product","config":{},"position":{"x":1,"y":0}},{"id":"end","kind":"end","label":"End","config":{},"position":{"x":2,"y":0}}],"edges":[{"id":"a","source":"start","target":"product","port":"next"},{"id":"b","source":"product","target":"end","port":"next"}],"flows":[{"id":"order","kind":"order","label":"Order","entryNodeId":"product","nodeIds":["product"]}]}'::jsonb,'{flows,0,productIds}',jsonb_build_array(product))
$$;
create function pg_temp.review_test_workflow(s jsonb) returns jsonb language sql as $$
 select jsonb_set(s,'{context,execution,orderReview,factsKey}',to_jsonb(jsonb_build_array(
  s->>'product_id',s->>'product_type_id',
  jsonb_build_array(s#>>'{visual,versionId}',coalesce(s#>>'{context,execution,linear,versionId}',s#>>'{linearSnapshot,versionId}'),s->>'orderWorkflowSnapshot'),
  jsonb_build_array(s#>>'{visual,binding,flowId}',s#>>'{visual,binding,entity,kind}',s#>>'{visual,binding,entity,id}'),
  coalesce((select jsonb_agg(jsonb_build_array(key,value) order by key) from jsonb_each(coalesce(s#>'{visual,branchPorts}','{}'))),'[]'::jsonb),
  '[]'::jsonb,'[]'::jsonb,s#>'{context,execution,orderTerms}')::text))
$$;
create function pg_temp.pin_test_order(b uuid,u uuid,s jsonb) returns jsonb language plpgsql as $$
declare revision integer; v uuid;
begin
 if current_database() not like '%\_w4\_test' escape '\' then raise exception 'Use isolated *_w4_test'; end if;
 select coalesce(w.revision,0) into revision from public.visual_workflows w where business_id=b;
 perform public.save_visual_workflow(b,u,coalesce(revision,0),pg_temp.order_test_graph((s->>'product_id')::uuid),'publish');
 select published_version_id into v from public.visual_workflows where business_id=b;
 return pg_temp.review_test_workflow(jsonb_set(s,'{visual}',jsonb_build_object('versionId',v,'nodeId','end','visited',jsonb_build_array('start','product','end'),
  'binding',jsonb_build_object('flowId','order','entity',jsonb_build_object('kind','product','id',s->>'product_id')))));
end $$;
