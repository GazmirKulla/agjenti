-- Business setting per product: products.agent_orders. When false, the agent presents the product and
-- answers about it but never takes an order for it (information only). Staff can still record an
-- order for it by hand. The server refuses an agent order for such a product at submission.
--
-- Requires 20261116200000_optional_customer_fields.sql (submit_process_order is copied from it with
-- one added check). Additive: run it before deploying the app that reads the column.
-- Rollback: recreate submit_process_order from 20261116200000_optional_customer_fields.sql, then
-- alter table public.products drop column agent_orders.
begin;
set local lock_timeout='5s';

alter table public.products add column if not exists agent_orders boolean not null default true;
comment on column public.products.agent_orders is 'False: the agent only informs about this product and never takes an order for it.';

create or replace function public.submit_process_order(
 p_business uuid,p_conversation uuid,p_revision integer,p_action uuid,p_user uuid,p_job bigint,p_token uuid,p_files jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 c public.conversations; s public.conversation_states; b public.businesses; p public.products; prior public.order_submissions;
 linear_workflow uuid; dependency_workflow uuid; dependency_steps jsonb; configured_step jsonb; configured_key text; job public.workflow_inbound_queue; instance jsonb; action jsonb; input jsonb; graph jsonb; flow jsonb;
 review jsonb; saved_review jsonb; p_order jsonb; p_automated boolean:=p_user is null;
 cid uuid; oid uuid; tid uuid; type_key text; request_payload jsonb;
 v public.product_variants; unit numeric; variant_count integer; qty numeric; total numeric;
 built jsonb; sel jsonb; url text;
begin
 if p_automated then
  select * into job from public.workflow_inbound_queue where id=p_job and business_id=p_business and lease_token=p_token
    and status='processing' and leased_until>now() for update;
  if not found then raise exception 'lease_lost'; end if;
 else
  perform public.assert_order_actor(p_business,p_user);
  if p_job is not null or p_token is not null then raise exception 'invalid_order_scope'; end if;
 end if;
 -- Only staff choose the photos that go to the website; the agent never sends files.
 if p_files is not null and (p_automated or jsonb_typeof(p_files) is distinct from 'object') then raise exception 'invalid_order_scope'; end if;
 select * into c from public.conversations where id=p_conversation and business_id=p_business for update;
 if not found then raise exception 'conversation_unavailable'; end if;
 if p_automated and (c.status<>'active' or not public.workflow_conversation_matches(c,job)) then raise exception 'ownership_lost'; end if;
 select * into s from public.conversation_states where conversation_id=p_conversation and business_id=p_business for update;
 if not found or s.revision is distinct from p_revision then raise exception 'stale_state'; end if;
 if s.collected->>'schemaVersion' is distinct from '4' or s.collected->>'mode' is distinct from 'live'
   or s.collected->>'businessId' is distinct from p_business::text or s.collected->>'conversationId' is distinct from p_conversation::text
   then raise exception 'invalid_order_scope'; end if;
 select i.value into instance from jsonb_each(s.collected->'instances') i where i.value->'action'->>'id'=p_action::text;
 action:=instance->'action'; input:=action->'input';
 if action->>'tool' is distinct from 'order.create' or action->>'toolVersion' is distinct from '1'
   then raise exception 'invalid_order_scope'; end if;
 review:=jsonb_build_object('actionId',p_action,'approval',action->'approval','inputDigest',action->'inputDigest');
 select * into prior from public.order_submissions where business_id=p_business and conversation_id=p_conversation and confirmation_id=p_action;
 if found then
  if prior.confirmation is distinct from review then raise exception 'confirmation_conflict'; end if;
  return jsonb_build_object('orderId',prior.order_id,'attemptId',prior.attempt_id,'status',prior.status,'externalOrderId',prior.external_order_id,'dispatch',false);
 end if;
 if p_automated then
  select confirmation into saved_review from public.process_order_reviews
    where business_id=p_business and conversation_id=p_conversation and action_id=p_action;
  if found then
    if saved_review is distinct from review then raise exception 'confirmation_conflict'; end if;
    return jsonb_build_object('status','awaiting_staff','dispatch',false);
  end if;
 end if;
 if (p_automated and action->>'status' is distinct from 'running')
   or (not p_automated and (action->>'status' is distinct from 'succeeded' or action#>>'{output,submissionStatus}' is distinct from 'awaiting_staff'))
   or coalesce((action#>>'{approval,expiresAt}')::numeric,0)<=extract(epoch from clock_timestamp())*1000
   or action#>>'{approval,waitId}' is null then raise exception 'confirmation_required'; end if;
 select * into b from public.businesses where id=p_business for share;
 if p_automated and not coalesce(c.auto_reply,b.auto_reply,false) then raise exception 'ownership_lost'; end if;
 if not public.business_module_allowed(p_business,'orders') or not public.business_module_allowed(p_business,'products')
   or not public.business_module_allowed(p_business,'workflows') then raise exception 'module_disabled'; end if;
 if exists(select 1 from jsonb_array_elements(coalesce(b.agent_collection_policy->'scopes','[]'::jsonb)) scope
   where scope->>'versionId'=instance->>'versionId' and scope->>'flowId'=instance->>'definitionId' and scope->>'mode'='collection_only')
   then raise exception 'collection_effect_denied'; end if;
 -- The alias is not "v": that name is the chosen variant, and PL/pgSQL read v.graph from it (every visual-flow order failed).
 select wv.graph into graph from public.visual_workflow_versions wv where wv.business_id=p_business and wv.id=(instance->>'versionId')::uuid;
 if graph is null then
  select workflow_id into linear_workflow from public.linear_workflow_versions where business_id=p_business and id=(instance->>'versionId')::uuid;
  if not found or instance->>'definitionId' is distinct from 'linear_'||linear_workflow::text then raise exception 'workflow_not_ready'; end if;
 end if;
 if graph->>'version'='2' then
  select f into flow from jsonb_array_elements(graph->'flows') f where f->>'id'=instance->>'definitionId';
  if flow is null then raise exception 'workflow_not_ready'; end if;
  if jsonb_array_length(coalesce(flow->'productIds','[]'::jsonb))>0 and not (flow->'productIds' ? (input->>'productId')) then raise exception 'product_changed'; end if;
 end if;
 select * into p from public.products where business_id=p_business and id=(input->>'productId')::uuid and is_active for share;
 if not found then raise exception 'product_unavailable'; end if;
 -- The owner marked this product for information only: the agent presents it but never takes an order for it.
 if not p.agent_orders then raise exception 'product_information_only'; end if;
 -- Bindings are pinned when the product is accepted. Reassignment/publishing
 -- changes future requests; it cannot rewrite an already reviewed request.
 if instance#>>'{productWorkflow,productId}' is distinct from p.id::text then raise exception 'product_workflow_changed'; end if;
 if linear_workflow is null then
  if instance#>>'{productWorkflow,versionId}' is not null then
    select workflow_id,steps into dependency_workflow,dependency_steps from public.linear_workflow_versions
      where business_id=p_business and id=(instance#>>'{productWorkflow,versionId}')::uuid;
    if not found or dependency_workflow::text is distinct from instance#>>'{productWorkflow,workflowId}' then raise exception 'product_workflow_changed'; end if;
  elsif instance#>>'{productWorkflow,workflowId}' is not null then raise exception 'product_workflow_changed'; end if;
 else
  if instance#>>'{productWorkflow,workflowId}' is distinct from linear_workflow::text
    or instance#>>'{productWorkflow,versionId}' is distinct from instance->>'versionId' then raise exception 'product_workflow_changed'; end if;
  select steps into dependency_steps from public.linear_workflow_versions
    where business_id=p_business and id=(instance->>'versionId')::uuid;
 end if;
 for configured_step in select value from jsonb_array_elements(coalesce(dependency_steps,'[]'::jsonb)) loop
  if configured_step->>'kind' in ('customer','confirm') then continue; end if;
  configured_key:=coalesce(configured_step->>'fieldKey',configured_step->>'key');
  if not coalesce((configured_step->>'required')::boolean,true) and instance#>array['facts',configured_key,'value'] is null then continue; end if;
  if instance#>array['facts',configured_key,'value'] is null
    or (input->>'options')::jsonb->configured_key is distinct from instance#>array['facts',configured_key,'value']
    then raise exception 'product_fields_required'; end if;
  if configured_step->>'kind'='photo' and instance#>array['facts',configured_key,'value'] is distinct from 'true'::jsonb
    then raise exception 'product_fields_required'; end if;
  if configured_step->>'kind'='choice' and jsonb_array_length(coalesce(configured_step->'options','[]'::jsonb))>0
    and not (configured_step->'options' ? (instance#>>array['facts',configured_key,'value'])) then raise exception 'invalid_product_option'; end if;
 end loop;

 -- A product with variants needs the one variant the customer chose; its price wins over the product's.
 if exists(select 1 from public.product_variants where product_id=p.id and business_id=p_business and is_active) then
  if jsonb_typeof((input->>'options')::jsonb) is distinct from 'object' then raise exception 'variant_required'; end if;
  select count(*) into variant_count from public.product_variants pv where pv.product_id=p.id and pv.business_id=p_business and pv.is_active
    and not exists(select 1 from jsonb_each_text(pv.options) e where ((input->>'options')::jsonb)->>('variant_'||e.key) is distinct from e.value);
  if variant_count<>1 then raise exception 'variant_required'; end if;
  select * into v from public.product_variants pv where pv.product_id=p.id and pv.business_id=p_business and pv.is_active
    and not exists(select 1 from jsonb_each_text(pv.options) e where ((input->>'options')::jsonb)->>('variant_'||e.key) is distinct from e.value) for share;
 end if;
 -- Without its own variant price, only a fixed product price can be ordered.
 if v.price_amount is null and p.price_mode is distinct from 'fixed' then raise exception 'price_on_request'; end if;
 -- Choice lists kept on the product (e.g. gjatesia: ["2","3","4"]) when it has no variant rows.
 if v.id is null and exists(select 1 from jsonb_each(p.attributes) a where jsonb_typeof(a.value)='array'
   and not (a.value ? coalesce(((input->>'options')::jsonb)->>('variant_'||a.key),''))) then raise exception 'invalid_product_option'; end if;
 unit:=coalesce(v.price_amount,p.price_amount);
 if unit is null or unit<0 or p.currency!~'^[A-Z]{3}$'
  or input->>'productName' is distinct from p.name or (input->>'unitAmount')::numeric is distinct from unit
  or input->>'currency' is distinct from p.currency
  or input->>'productTypeId' is distinct from coalesce(p.product_type_id::text,'none') then raise exception 'commercial_terms_changed'; end if;
 -- A product priced per unit is ordered in that unit (0.5 m³); any other product is one item.
 if p.price_unit is null then
  if input->>'quantity' is distinct from '1' then raise exception 'commercial_terms_changed'; end if;
  qty:=1;
 else
  if jsonb_typeof(input->'quantity') is distinct from 'number' then raise exception 'commercial_terms_changed'; end if;
  qty:=(input->>'quantity')::numeric;
  if not public.order_unit_quantity_ok(qty) then raise exception 'invalid_quantity'; end if;
 end if;
 total:=round(unit*qty,2);
 if p.product_type_id is not null then
  select coalesce(external_key,id::text) into type_key from public.product_types where id=p.product_type_id and is_active for share;
  if not found then raise exception 'product_unavailable'; end if;
 end if;
 -- The name is always needed; the phone and the address unless the business made them optional.
 if nullif(btrim(input->>'name'),'') is null
   or nullif(btrim(input->>'phone'),'') is null and public.customer_field_required(p_business,'phone')
   or nullif(btrim(input->>'address'),'') is null and public.customer_field_required(p_business,'address') then raise exception 'customer_required'; end if;
 if jsonb_typeof((input->>'options')::jsonb) is distinct from 'object' then raise exception 'invalid_order_input'; end if;
 if coalesce(s.cart,'[]'::jsonb)<>'[]'::jsonb or coalesce((input->>'options')::jsonb->>'quantity','1')<>'1'
   or coalesce((input->>'options')::jsonb->>'collect_quantity','1')<>'1' then raise exception 'unsupported_order_scope'; end if;
 if p_automated then
  perform 1 from public.business_automation_policies where business_id=p_business and local_orders for share;
  if not found then
    insert into public.process_order_reviews(business_id,conversation_id,action_id,confirmation)
      values(p_business,p_conversation,p_action,review);
    return jsonb_build_object('status','awaiting_staff','dispatch',false);
  end if;
 end if;
 -- Integration payload projection only; the process snapshot remains the only writable conversation state.
 p_order:=jsonb_build_object('product_id',p.id,'variant_id',v.id,'variant_sku',v.sku,'product_type_id',p.product_type_id,'fields',(input->>'options')::jsonb,
   'quantity',qty,'unit',p.price_unit,
   'customer',jsonb_build_object('name',input->>'name','phone',input->>'phone','city',input->>'city','address',input->>'address'));
  cid:=c.customer_id;
  if cid is not null then
    perform 1 from public.customers where id=cid and business_id=p_business for share;
    if not found then raise exception 'customer_unavailable'; end if;
  elsif c.whatsapp_participant_id is not null then
    insert into public.customers(business_id,whatsapp_user_id,display_name,phone)
      values(p_business,c.whatsapp_participant_id,p_order#>>'{customer,name}',p_order#>>'{customer,phone}')
      on conflict(business_id,whatsapp_user_id) where whatsapp_user_id is not null
      do update set updated_at=now() returning id into cid;
  elsif c.instagram_participant_id is not null then
    insert into public.customers(business_id,instagram_user_id,username,display_name,phone)
      values(p_business,c.instagram_participant_id,c.participant_username,p_order#>>'{customer,name}',p_order#>>'{customer,phone}')
      on conflict(business_id,instagram_user_id) where instagram_user_id is not null
      do update set updated_at=now() returning id into cid;
  else
    insert into public.customers(business_id,display_name,phone)
      values(p_business,p_order#>>'{customer,name}',p_order#>>'{customer,phone}') returning id into cid;
  end if;
  perform public.apply_order_contact(p_business,cid,p_order#>>'{customer,name}',p_order#>>'{customer,phone}');
  update public.conversations set customer_id=cid,updated_at=now() where id=c.id;
  insert into public.orders(business_id,conversation_id,customer_id,status,currency,total_amount,payload)
    values(p_business,c.id,cid,'pending_reconciliation',p.currency,total,p_order) returning id into oid;
  -- The item's selection in the product's own keys (products.external_spec), the same shape as the owner's order.
  built:=public.process_order_selection(p.external_spec,v,(input->>'options')::jsonb,p_files);
  sel:=built->'selection';
  insert into public.order_items(order_id,product_id,variant_id,product_type_key,quantity,options,unit_amount,selection,position)
    values(oid,p.id,v.id,type_key,qty,coalesce(p_order->'fields','{}'),unit,case when p.external_spec is not null then sel end,1);
  insert into public.order_submissions(order_id,business_id,conversation_id,confirmation_id,confirmation,state_revision,created_by,executor_kind)
    values(oid,p_business,c.id,p_action,review,s.revision,p_user,case when p_automated then 'customer_agent' else 'owner' end) returning attempt_id into tid;
  if p_automated then
    update public.orders set status='confirmed' where id=oid and business_id=p_business;
    update public.order_submissions set status='local_only' where order_id=oid and business_id=p_business;
    return jsonb_build_object('orderId',oid,'attemptId',tid,'status','local_only','dispatch',false);
  end if;
  -- No orders URL: the order stays here.
  select nullif(btrim(orders_url),'') into url from public.integrations where business_id=p_business and kind='http';
  if url is null then return public.finish_order_submission(p_business,oid,tid,'local_only',null); end if;
  -- Something the website needs is missing or not one of its values: kept here, never sent incomplete.
  if built->>'missing' is not null then
    return public.finish_order_submission(p_business,oid,tid,'local_only',null)||jsonb_build_object('reason','missing_field','field',built->>'missing','line',1);
  end if;
  if built->>'invalid' is not null then
    return public.finish_order_submission(p_business,oid,tid,'local_only',null)||jsonb_build_object('reason','invalid_field','field',built->>'invalid','line',1);
  end if;
  begin
    perform public.check_order_selection(p_business,p_conversation,p,v,sel);
  exception when raise_exception then
    return public.finish_order_submission(p_business,oid,tid,'local_only',null)||jsonb_build_object('reason',sqlerrm,'line',1);
  end;
  -- The same request as the owner's order (contract v2). A product the website does not know stays here.
  request_payload:=public.order_dispatch_payload(p_business,oid,'agent');
  if request_payload ? 'reason' then
    return public.finish_order_submission(p_business,oid,tid,'local_only',null)||(request_payload-'dispatch');
  end if;
  -- Only the transaction winner gets permission to dispatch. Losing this response
  -- also loses permission: a retry reads the ledger and requires reconciliation.
  return jsonb_build_object('orderId',oid,'attemptId',tid,'status','pending_reconciliation','dispatch',true,'payload',request_payload);
end $$;
revoke all on function public.submit_process_order(uuid,uuid,integer,uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_process_order(uuid,uuid,integer,uuid,uuid,bigint,uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
