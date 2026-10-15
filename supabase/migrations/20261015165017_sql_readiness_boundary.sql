-- Package A SQL boundary. Forward-only; no data/backfill, new lifecycle, or ACL widening.
-- Catalog activity is NOT permission to create orders. Draft bindings may be inactive.
-- Rollout: explicit manual profiles must include required modules; unversioned /
-- sealed-only order executions fail closed and need a verifiable pin + new review.
-- Existing immutable versions/history are not backfilled, rewritten or republished.
begin;
set local search_path=pg_catalog,pg_temp;

-- Internal publication backstop, limited to product/order requirements of the graph.
-- Called from the existing version/activation trigger so AI and manual paths agree.
create or replace function public.assert_visual_catalog_readiness(p_business uuid,p_graph jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare b public.businesses; product_ids uuid[]; needs_products boolean; needs_orders boolean; prepares_order boolean; m text;
begin
 if not public.valid_visual_graph(p_graph,true) then raise exception 'invalid_graph'; end if;
 select * into b from public.businesses where id=p_business for share;
 if not found then raise exception 'unauthorized'; end if;
 select coalesce(array_agg((ref.value#>>'{}')::uuid),array[]::uuid[]) into product_ids
 from jsonb_array_elements(coalesce(p_graph->'flows','[]'::jsonb)) f
 cross join lateral jsonb_array_elements(coalesce(f->'productIds','[]'::jsonb)) ref(value);
 prepares_order:=exists(select 1 from jsonb_array_elements(p_graph->'nodes') n where n->>'kind'='product')
  or exists(select 1 from jsonb_array_elements(coalesce(p_graph->'flows','[]'::jsonb)) f
   where f->>'kind'='order' or (f->>'kind'='custom' and jsonb_array_length(coalesce(f->'productIds','[]'::jsonb))>0));
 needs_orders:=prepares_order or exists(select 1 from jsonb_array_elements(p_graph->'nodes') n where n->>'kind'='order_status');
 needs_products:=prepares_order or cardinality(product_ids)>0;
 foreach m in array array['workflows'] || case when needs_products then array['products'] else array[]::text[] end
  || case when needs_orders then array['orders'] else array[]::text[] end loop
  if not public.business_module_allowed(p_business,m)
   or (b.dashboard_profile is not null and b.dashboard_profile->>'source' is distinct from 'legacy'
    and not coalesce(b.dashboard_profile->'enabledModules' ? m,false)) then raise exception 'module_disabled'; end if;
 end loop;
 -- Hold the referenced rows against deactivation/deletion until publication commits.
 perform id from public.products where business_id=p_business and id=any(product_ids) order by id for share;
 if (select count(*) from public.products where business_id=p_business and id=any(product_ids) and is_active)<>cardinality(product_ids)
  then raise exception 'invalid_workflow_targets'; end if;
 if needs_products and cardinality(product_ids)=0 then
  perform id from public.products where business_id=p_business and is_active order by id limit 1 for share;
  if not found then raise exception 'active_products_required'; end if;
 end if;
end $$;
revoke all on function public.assert_visual_catalog_readiness(uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.guard_action_workflow_publication() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare g jsonb; actor uuid;
begin
 if tg_table_name='visual_workflow_versions' then g:=new.graph; actor:=new.created_by;
 else
  if not new.enabled then return new; end if;
  -- A draft save must not revalidate/change the immutable active version.
  if tg_op='UPDATE' and old.enabled and new.published_version_id is not distinct from old.published_version_id then return new; end if;
  select graph into g from public.visual_workflow_versions where id=new.published_version_id and business_id=new.business_id;
  -- Preserve the existing composite FK/check error for a missing/foreign pointer.
  if not found then return new; end if;
  actor:=new.updated_by;
 end if;
 perform public.assert_visual_catalog_readiness(new.business_id,g);
 if exists(select 1 from jsonb_array_elements(g->'nodes') n where n->>'kind'='action') then
  if not public.can_execute_business_action(new.business_id,actor,'business.provision',false)
   or not public.can_execute_business_action(new.business_id,null,'business.provision',true) then raise exception 'action_denied'; end if;
 end if;
 return new;
end $$;

-- Verify persisted workflow evidence, not a caller-supplied readiness boolean.
-- Linear published versions remain supported; no visual workflow is required for them.
create or replace function public.assert_order_workflow_ready(p_business uuid,p_product uuid,p_source jsonb,p_order jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 snapshot jsonb:=p_source#>'{processes,order,snapshot}';
 live boolean:=coalesce(p_source#>>'{context,execution,factOwner}','order')='order';
 source_order jsonb; source_execution jsonb; source_visual jsonb; visual jsonb:=p_order->'visual';
 linear jsonb; source_linear jsonb; g jsonb; f jsonb; binding jsonb; version public.linear_workflow_versions;
 linked_workflow uuid; facts jsonb; workflow_key jsonb; binding_key jsonb; found_path boolean:=false;
begin
 source_order:=case when live then p_source else snapshot end;
 source_execution:=case when live then p_source#>'{context,execution}' else snapshot->'execution' end;
 source_visual:=case when snapshot is not null and not (live and coalesce(p_source#>>'{processes,active}','')='order'
  and p_source#>'{processes,auxiliary}' is null) then snapshot->'visual' else p_source->'visual' end;
 source_linear:=coalesce(source_execution->'linear',source_order->'linearSnapshot');
 linear:=coalesce(p_order#>'{context,execution,linear}',p_order->'linearSnapshot');
 if source_order->>'product_id' is distinct from p_product::text
  or source_order->>'product_type_id' is distinct from p_order->>'product_type_id'
  or source_execution->'orderReview' is distinct from p_order#>'{context,execution,orderReview}'
  or source_execution->>'orderConfirmed' is distinct from 'true'
  or source_execution->'orderTerms' is distinct from p_order#>'{context,execution,orderTerms}'
  or source_linear is distinct from linear
  or source_visual->>'versionId' is distinct from visual->>'versionId'
  or source_visual->>'nodeId' is distinct from visual->>'nodeId'
  or source_visual->'visited' is distinct from visual->'visited'
  or source_visual->'binding' is distinct from visual->'binding'
  or source_visual->'branchPorts' is distinct from visual->'branchPorts'
  or source_order->>'orderWorkflowSnapshot' is distinct from p_order->>'orderWorkflowSnapshot'
  then raise exception 'workflow_not_ready'; end if;

 if visual is not null and visual<>'null'::jsonb then
  -- Old immutable pins remain valid after republish, but explicit disable stops new actions.
  select v.graph into g from public.visual_workflow_versions v
   join public.visual_workflows w on w.business_id=v.business_id and w.enabled and w.published_version_id is not null
   where v.business_id=p_business and v.id::text=visual->>'versionId' for share of w;
  if not found or not public.valid_visual_graph(g,true)
   or not exists(select 1 from jsonb_array_elements(g->'nodes') n where n->>'id'=visual->>'nodeId')
   or jsonb_typeof(visual->'visited') is distinct from 'array' then raise exception 'workflow_not_ready'; end if;
  binding:=visual->'binding';
  if g->>'version'='1' then
   found_path:=binding is null and exists(select 1 from jsonb_array_elements(g->'nodes') n
    where n->>'kind'='product' and visual->'visited' ? (n->>'id'));
  else
   for f in select value from jsonb_array_elements(g->'flows') loop
    if jsonb_array_length(coalesce(f->'serviceIds','[]'::jsonb))>0 then continue; end if;
    if jsonb_array_length(coalesce(f->'productIds','[]'::jsonb))>0 and not (f->'productIds' ? p_product::text) then continue; end if;
    if binding is not null and (binding->>'flowId' is distinct from f->>'id' or binding#>>'{entity,kind}' is distinct from 'product'
      or binding#>>'{entity,id}' is distinct from p_product::text or not coalesce(f->'productIds' ? p_product::text,false)) then continue; end if;
    if (f->>'kind'='order' or (f->>'kind'='custom' and jsonb_array_length(coalesce(f->'productIds','[]'::jsonb))>0)
     or exists(select 1 from jsonb_array_elements(g->'nodes') n where n->>'kind'='product' and f->'nodeIds' ? (n->>'id')))
     and exists(select 1 from jsonb_array_elements_text(f->'nodeIds') id where visual->'visited' ? id) then found_path:=true; exit; end if;
   end loop;
  end if;
  if not found_path then raise exception 'workflow_not_ready'; end if;
 else
  -- Drafts live separately. Only a tenant-owned immutable linear version with
  -- identical steps and the current product binding is executable. A sealed-only
  -- legacy token cannot be decoded/verified here and must fail closed, not fallback.
  select workflow_id into linked_workflow from public.products where id=p_product and business_id=p_business;
  select * into version from public.linear_workflow_versions where business_id=p_business
   and workflow_id=linked_workflow and workflow_id::text=linear->>'id' and id::text=linear->>'versionId';
  if not found or version.steps is distinct from linear->'steps'
   or not public.valid_linear_definition(jsonb_build_object('name',version.name,'steps',version.steps))
   then raise exception 'workflow_not_ready'; end if;
 end if;

 -- W2 confirmation equality key includes the exact workflow version and binding.
 -- Compare JSON, not serialization whitespace or a new client readiness flag.
 begin facts:=(p_order#>>'{context,execution,orderReview,factsKey}')::jsonb;
 exception when invalid_text_representation then raise exception 'confirmation_required'; end;
 workflow_key:=jsonb_build_array(visual->>'versionId',linear->>'versionId',p_order->>'orderWorkflowSnapshot');
 binding_key:=jsonb_build_array(visual#>>'{binding,flowId}',visual#>>'{binding,entity,kind}',visual#>>'{binding,entity,id}');
 if facts->0 is distinct from to_jsonb(p_product::text)
  or facts->1 is distinct from coalesce(to_jsonb(p_order->>'product_type_id'),'null'::jsonb)
  or facts->2 is distinct from workflow_key or facts->3 is distinct from binding_key
  or facts->7 is distinct from p_order#>'{context,execution,orderTerms}'
  or jsonb_typeof(facts->4) is distinct from 'array' then raise exception 'confirmation_required'; end if;
 if exists(select 1 from jsonb_array_elements(facts->4) entry where jsonb_typeof(entry) is distinct from 'array'
   or jsonb_array_length(entry)<>2 or visual->'branchPorts'->(entry->>0) is distinct from entry->1)
  or jsonb_array_length(facts->4)<>(select count(*) from jsonb_object_keys(coalesce(visual->'branchPorts','{}'::jsonb)))
  then raise exception 'confirmation_required'; end if;
end $$;
revoke all on function public.assert_order_workflow_ready(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Existing signatures, ACLs, idempotency ledger and atomic writes are preserved.
create or replace function public.save_visual_workflow(p_business uuid,p_user uuid,p_revision integer,p_graph jsonb,p_operation text)
returns integer language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare current public.visual_workflows; version_id uuid; product_ids uuid[]; service_ids uuid[];
begin
 perform 1 from public.businesses where id=p_business for update;
 if not found or not(exists(select 1 from public.business_users where business_id=p_business and user_id=p_user) or exists(select 1 from public.platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 if p_operation is null or p_operation not in ('draft','publish','enable','disable') then raise exception 'invalid_operation'; end if;
 select * into current from public.visual_workflows where business_id=p_business;
 if p_revision is null or coalesce(current.revision,0)<>p_revision then raise exception 'stale_workflow'; end if;
 if p_operation in ('draft','publish') then
  if not public.valid_visual_graph(p_graph,p_operation='publish') then raise exception 'invalid_graph'; end if;
  if p_graph->>'version'='2' then
   select coalesce(array_agg((requested.value#>>'{}')::uuid),array[]::uuid[]) into product_ids
    from jsonb_array_elements(p_graph->'flows') flow
    cross join lateral jsonb_array_elements(coalesce(flow->'productIds','[]'::jsonb)) requested(value);
   select coalesce(array_agg((requested.value#>>'{}')::uuid),array[]::uuid[]) into service_ids
    from jsonb_array_elements(p_graph->'flows') flow
    cross join lateral jsonb_array_elements(coalesce(flow->'serviceIds','[]'::jsonb)) requested(value);
   -- Lock catalog rows while checking ownership, preventing deletion or tenant
   -- reassignment between validation and the atomic draft/publication write.
   perform id from public.products where business_id=p_business and id=any(product_ids) order by id for share;
   perform id from public.booking_services where business_id=p_business and id=any(service_ids) order by id for share;
   if (select count(*) from public.products where business_id=p_business and id=any(product_ids))<>cardinality(product_ids)
    or (select count(*) from public.booking_services where business_id=p_business and id=any(service_ids))<>cardinality(service_ids)
    then raise exception 'invalid_workflow_targets'; end if;
  end if;
  if p_operation='publish' then
   insert into public.visual_workflow_versions(business_id,graph,created_by) values(p_business,p_graph,p_user) returning id into version_id;
  end if;
  insert into public.visual_workflows(business_id,draft,revision,published_version_id,enabled,updated_by)
   values(p_business,p_graph,p_revision+1,version_id,p_operation='publish',p_user)
  on conflict(business_id) do update set draft=p_graph,revision=p_revision+1,
   published_version_id=coalesce(version_id,visual_workflows.published_version_id),
   enabled=case when p_operation='publish' then true else visual_workflows.enabled end,
   updated_by=p_user,updated_at=now();
 else
  if current.business_id is null or (p_operation='enable' and current.published_version_id is null) then raise exception 'no_published_workflow'; end if;
  if p_operation='enable' then
   perform public.assert_visual_catalog_readiness(p_business,(select graph from public.visual_workflow_versions
    where business_id=p_business and id=current.published_version_id));
  end if;
  update public.visual_workflows set enabled=p_operation='enable',revision=p_revision+1,updated_by=p_user,updated_at=now() where business_id=p_business;
 end if;
 return p_revision+1;
end $$;

create or replace function public.submit_confirmed_order(
  p_business uuid,p_user uuid,p_conversation uuid,p_revision integer,
  p_collected jsonb,p_order jsonb,p_enforce_modules boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  c public.conversations; s public.conversation_states; b public.businesses; p public.products; prior public.order_submissions;
  review jsonb:=p_order#>'{context,execution,orderReview}';
  terms jsonb:=p_order#>'{context,execution,orderTerms}';
  cid uuid; oid uuid; tid uuid; type_key text; review_id uuid; request_payload jsonb;
begin
  perform public.assert_order_actor(p_business,p_user);
  select * into c from public.conversations where id=p_conversation and business_id=p_business for update;
  if not found then raise exception 'conversation_unavailable'; end if;
  review_id:=(review->>'id')::uuid;
  if review_id is null then raise exception 'confirmation_required'; end if;
  select * into prior from public.order_submissions where business_id=p_business and conversation_id=p_conversation
    and confirmation_id=review_id;
  if found then
    if prior.confirmation is distinct from review then raise exception 'confirmation_conflict'; end if;
    return jsonb_build_object('orderId',prior.order_id,'attemptId',prior.attempt_id,'status',prior.status,
      'externalOrderId',prior.external_order_id,'dispatch',false);
  end if;
  select * into s from public.conversation_states where conversation_id=p_conversation and business_id=p_business for update;
  if not found or s.revision is distinct from p_revision or s.collected is distinct from p_collected then raise exception 'stale_state'; end if;
  if coalesce(s.cart,'[]')<>'[]'::jsonb then raise exception 'unsupported_order_scope'; end if;
  -- The service has restored canonical order facts and checked their W2 equality key.
  -- Fence the exact source snapshot, plus the receipt it contains, before any writes.
  if review is null or (review is distinct from s.collected#>'{context,execution,orderReview}'
      and review is distinct from s.collected#>'{processes,order,snapshot,execution,orderReview}')
    or p_order->>'step_key' is distinct from 'order_ready'
    or p_order#>>'{context,execution,orderConfirmed}' is distinct from 'true'
    or s.status='cancelled'
    or review->>'confirmed' is distinct from 'true'
    or coalesce((review->>'expiresAt')::numeric,0)<=extract(epoch from clock_timestamp())*1000
    then raise exception 'confirmation_required'; end if;
  select * into b from public.businesses where id=p_business for share;
  if not public.business_module_allowed(p_business,'orders') or not public.business_module_allowed(p_business,'products')
    or not public.business_module_allowed(p_business,'workflows') then raise exception 'module_disabled'; end if;
  -- Explicit module settings apply at this final side-effect boundary even outside
  -- the workflow rollout. Legacy absent profiles keep the existing rollout switch.
  if p_enforce_modules or (b.dashboard_profile is not null and b.dashboard_profile->>'source' is distinct from 'legacy') then
    if not coalesce((b.dashboard_profile->'enabledModules') @> '["orders","products","workflows"]'::jsonb,false)
      then raise exception 'module_disabled'; end if;
  end if;
  select * into p from public.products where id=(p_order->>'product_id')::uuid and business_id=p_business and is_active for share;
  if not found then raise exception 'product_unavailable'; end if;
  if p.price_amount is null or p.price_amount<0 or p.currency!~'^[A-Z]{3}$'
    or terms->>'productId' is distinct from p.id::text
    or (terms->>'unitAmount')::numeric is distinct from p.price_amount
    or terms->>'currency' is distinct from p.currency
    or terms->>'quantity' is distinct from '1'
    then raise exception 'commercial_terms_changed'; end if;
  if p.product_type_id is distinct from nullif(p_order->>'product_type_id','')::uuid then raise exception 'product_changed'; end if;
  if p.product_type_id is not null then
    -- Product types are a global, platform-managed catalog (not tenant rows).
    select coalesce(external_key,id::text) into type_key from public.product_types where id=p.product_type_id and is_active for share;
    if not found then raise exception 'product_unavailable'; end if;
  end if;
  if nullif(trim(p_order#>>'{customer,name}'),'') is null or nullif(trim(p_order#>>'{customer,phone}'),'') is null
    or nullif(trim(p_order#>>'{customer,address}'),'') is null then raise exception 'customer_required'; end if;
  if coalesce(p_order#>>'{fields,quantity}','1')<>'1' or coalesce(p_order#>>'{fields,collect_quantity}','1')<>'1'
    then raise exception 'unsupported_order_scope'; end if;
  perform public.assert_order_workflow_ready(p_business,p.id,s.collected,p_order);
  cid:=c.customer_id;
  if cid is not null then
    perform 1 from public.customers where id=cid and business_id=p_business for share;
    if not found then raise exception 'customer_unavailable'; end if;
  elsif c.whatsapp_participant_id is not null then
    insert into public.customers(business_id,whatsapp_user_id,display_name,phone)
      values(p_business,c.whatsapp_participant_id,p_order#>>'{customer,name}',p_order#>>'{customer,phone}')
      on conflict(business_id,whatsapp_user_id) where whatsapp_user_id is not null
      do update set display_name=excluded.display_name,phone=excluded.phone,updated_at=now() returning id into cid;
  elsif c.instagram_participant_id is not null then
    insert into public.customers(business_id,instagram_user_id,username,display_name,phone)
      values(p_business,c.instagram_participant_id,c.participant_username,p_order#>>'{customer,name}',p_order#>>'{customer,phone}')
      on conflict(business_id,instagram_user_id) where instagram_user_id is not null
      do update set display_name=excluded.display_name,phone=excluded.phone,updated_at=now() returning id into cid;
  else
    insert into public.customers(business_id,display_name,phone)
      values(p_business,p_order#>>'{customer,name}',p_order#>>'{customer,phone}') returning id into cid;
  end if;
  update public.conversations set customer_id=cid,updated_at=now() where id=c.id;
  insert into public.orders(business_id,conversation_id,customer_id,status,currency,total_amount,payload)
    values(p_business,c.id,cid,'pending_reconciliation',p.currency,p.price_amount,p_order) returning id into oid;
  insert into public.order_items(order_id,product_id,product_type_key,external_format_id,quantity,options,unit_amount)
    values(oid,p.id,type_key,p_order#>>'{fields,collect_size}',1,coalesce(p_order->'fields','{}'),p.price_amount);
  insert into public.order_submissions(order_id,business_id,conversation_id,confirmation_id,confirmation,state_revision,created_by)
    values(oid,p_business,c.id,review_id,review,s.revision,p_user) returning attempt_id into tid;
  -- Do not overwrite a booking/service cursor, canonical facts or pinned versions.
  if s.collected->>'step_key'='order_ready' and s.collected->>'product_id'=p.id::text
    and coalesce(s.collected#>>'{context,execution,factOwner}','order')='order' then
    update public.conversation_states set status='submitted',revision=revision+1,updated_at=now() where conversation_id=c.id and business_id=p_business;
  end if;
  request_payload:=jsonb_build_object('channel',c.channel,'customer',jsonb_build_object(
    'name',p_order#>>'{customer,name}','phone',p_order#>>'{customer,phone}',
    'city',p_order#>>'{customer,city}','address',p_order#>>'{customer,address}'),
    'currency',p.currency,'totalAmount',p.price_amount,'items',jsonb_build_array(jsonb_build_object(
      'productId',coalesce(p.external_id,p.id::text),'productType',type_key,
      'formatId',p_order#>'{fields,collect_size}','colorId',p_order#>'{fields,collect_color}',
      'character',p_order#>'{fields,collect_theme}','options',coalesce(p_order->'fields','{}'),
      'quantity',1,'unitAmount',p.price_amount,'currency',p.currency)));
  -- Only the transaction winner gets permission to dispatch. Losing this response
  -- also loses permission: a retry reads the ledger and requires reconciliation.
  return jsonb_build_object('orderId',oid,'attemptId',tid,'status','pending_reconciliation','dispatch',true,'payload',request_payload);
end $$;

notify pgrst, 'reload schema';
commit;
