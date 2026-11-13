-- Quantities for products priced per unit (price_unit: m³, m, copë…): a wood board at
-- 1200 ALL/m³ can be ordered as 0.5 m³. A product without a unit keeps the earlier
-- rules: the agent's order is one item, the owner's manual order a whole number 1–999.
-- Totals are computed here from the catalog price and the quantity, never taken from input.
-- Rollback: recreate submit_process_order and create_manual_order(…, integer, …) from
-- 20261114180000_product_price_modes_choices.sql, drop order_unit_quantity_ok and
-- order_items_quantity_positive; order_items.quantity can stay numeric.
begin;

-- A quantity of a unit-priced product: positive, at most 100000, at most three decimals.
create or replace function public.order_unit_quantity_ok(q numeric) returns boolean language sql immutable set search_path=pg_catalog,pg_temp as $$
 select q is not null and q::text not in ('NaN','Infinity','-Infinity') and q>0 and q<=100000 and q=round(q,3)
$$;

alter table public.order_items alter column quantity type numeric using quantity::numeric;
alter table public.order_items drop constraint if exists order_items_quantity_positive;
-- NOT VALID: checked for every new or changed row without rescanning earlier orders.
alter table public.order_items add constraint order_items_quantity_positive check (quantity>0 and quantity<=100000) not valid;

create or replace function public.submit_process_order(
 p_business uuid,p_conversation uuid,p_revision integer,p_action uuid,p_user uuid,p_job bigint,p_token uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 c public.conversations; s public.conversation_states; b public.businesses; p public.products; prior public.order_submissions;
 linear_workflow uuid; dependency_workflow uuid; dependency_steps jsonb; configured_step jsonb; configured_key text; job public.workflow_inbound_queue; instance jsonb; action jsonb; input jsonb; graph jsonb; flow jsonb;
 review jsonb; saved_review jsonb; p_order jsonb; p_automated boolean:=p_user is null;
 cid uuid; oid uuid; tid uuid; type_key text; request_payload jsonb;
 v public.product_variants; unit numeric; variant_count integer; qty numeric; total numeric;
begin
 if p_automated then
  select * into job from public.workflow_inbound_queue where id=p_job and business_id=p_business and lease_token=p_token
    and status='processing' and leased_until>now() for update;
  if not found then raise exception 'lease_lost'; end if;
 else
  perform public.assert_order_actor(p_business,p_user);
  if p_job is not null or p_token is not null then raise exception 'invalid_order_scope'; end if;
 end if;
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
 if nullif(btrim(input->>'name'),'') is null or nullif(btrim(input->>'phone'),'') is null or nullif(btrim(input->>'address'),'') is null then raise exception 'customer_required'; end if;
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
    values(p_business,c.id,cid,'pending_reconciliation',p.currency,total,p_order) returning id into oid;
  insert into public.order_items(order_id,product_id,variant_id,product_type_key,external_format_id,quantity,options,unit_amount)
    values(oid,p.id,v.id,type_key,p_order#>>'{fields,collect_size}',qty,coalesce(p_order->'fields','{}'),unit);
  insert into public.order_submissions(order_id,business_id,conversation_id,confirmation_id,confirmation,state_revision,created_by,executor_kind)
    values(oid,p_business,c.id,p_action,review,s.revision,p_user,case when p_automated then 'customer_agent' else 'owner' end) returning attempt_id into tid;
  if p_automated then
    update public.orders set status='confirmed' where id=oid and business_id=p_business;
    update public.order_submissions set status='local_only' where order_id=oid and business_id=p_business;
    return jsonb_build_object('orderId',oid,'attemptId',tid,'status','local_only','dispatch',false);
  end if;
  request_payload:=jsonb_build_object('channel',c.channel,'customer',jsonb_build_object(
    'name',p_order#>>'{customer,name}','phone',p_order#>>'{customer,phone}',
    'city',p_order#>>'{customer,city}','address',p_order#>>'{customer,address}'),
    'currency',p.currency,'totalAmount',total,'items',jsonb_build_array(jsonb_build_object(
      'productId',coalesce(p.external_id,p.id::text),'variantId',v.id,'sku',coalesce(v.sku,p.sku),'productType',type_key,
      'formatId',p_order#>'{fields,collect_size}','colorId',p_order#>'{fields,collect_color}',
      'character',p_order#>'{fields,collect_theme}','options',coalesce(p_order->'fields','{}'),
      'quantity',qty,'unitAmount',unit,'currency',p.currency)));
  -- Only the transaction winner gets permission to dispatch. Losing this response
  -- also loses permission: a retry reads the ledger and requires reconciliation.
  return jsonb_build_object('orderId',oid,'attemptId',tid,'status','pending_reconciliation','dispatch',true,'payload',request_payload);
end $$;
revoke all on function public.submit_process_order(uuid,uuid,integer,uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.submit_process_order(uuid,uuid,integer,uuid,uuid,bigint,uuid) to service_role;

-- The integer signature is replaced; keeping both would make the RPC call ambiguous.
drop function if exists public.create_manual_order(uuid,uuid,uuid,uuid,integer,jsonb,text,text,uuid);
create or replace function public.create_manual_order(
  p_business uuid, p_user uuid, p_conversation uuid, p_product uuid, p_quantity numeric,
  p_customer jsonb, p_note text, p_request_key text, p_variant uuid default null
) returns uuid language plpgsql security definer set search_path=public, pg_temp as $$
declare c public.conversations; p public.products; v public.product_variants; unit numeric; total numeric; cid uuid; oid uuid; v_name text; v_phone text;
begin
 if not exists(select 1 from business_users where business_id = p_business and user_id = p_user)
  and not exists(select 1 from platform_admins where user_id = p_user) then raise exception 'unauthorized'; end if;
 if p_request_key is null or char_length(p_request_key) not between 8 and 200 then raise exception 'invalid_request'; end if;
 select id into oid from orders where business_id = p_business and payload->>'source' = 'manual' and payload->>'requestKey' = p_request_key;
 if found then return oid; end if;
 if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<=0 or p_quantity>100000 then raise exception 'invalid_quantity'; end if;
 if jsonb_typeof(p_customer) is distinct from 'object' or octet_length(p_customer::text) > 4000 then raise exception 'invalid_customer'; end if;
 v_name := nullif(btrim(p_customer->>'name'), '');
 v_phone := nullif(btrim(p_customer->>'phone'), '');
 if v_name is null or char_length(v_name) not between 2 and 120 or v_phone is null or char_length(v_phone) > 40 then raise exception 'customer_required'; end if;
 if char_length(coalesce(p_note, '')) > 1000 then raise exception 'invalid_note'; end if;

 select * into c from conversations where id = p_conversation and business_id = p_business for update;
 if not found then raise exception 'invalid_conversation'; end if;
 select * into p from products where id = p_product and business_id = p_business for share;
 if not found or not p.is_active or p.archived_at is not null then raise exception 'product_unavailable'; end if;
 if p_variant is not null then
  select * into v from product_variants where id = p_variant and product_id = p.id and business_id = p_business and is_active for share;
  if not found then raise exception 'variant_unavailable'; end if;
 elsif exists(select 1 from product_variants where product_id = p.id and business_id = p_business and is_active) then
  raise exception 'variant_required';
 end if;
 if v.price_amount is null and p.price_mode is distinct from 'fixed' then raise exception 'price_on_request'; end if;
 unit := coalesce(v.price_amount, p.price_amount);
 if unit is null or unit < 0 or p.currency !~ '^[A-Z]{3}$' then raise exception 'price_missing'; end if;
 -- Priced per unit (m³, m…): up to three decimals. Otherwise whole items, 1–999.
 if p.price_unit is null and (p_quantity <> trunc(p_quantity) or p_quantity > 999) then raise exception 'invalid_quantity'; end if;
 if p.price_unit is not null and not public.order_unit_quantity_ok(p_quantity) then raise exception 'invalid_quantity'; end if;
 total := round(unit * p_quantity, 2);

 -- The conversation's customer, an existing one with the same channel identity, or a new one.
 cid := c.customer_id;
 if cid is not null then
  perform 1 from customers where id = cid and business_id = p_business;
  if not found then cid := null; end if;
 end if;
 if cid is null and c.whatsapp_participant_id is not null then
  select id into cid from customers where business_id = p_business and whatsapp_user_id = c.whatsapp_participant_id limit 1;
 elsif cid is null and c.instagram_participant_id is not null then
  select id into cid from customers where business_id = p_business and instagram_user_id = c.instagram_participant_id limit 1;
 end if;
 if cid is null then
  insert into customers(business_id, instagram_user_id, whatsapp_user_id, username, display_name, phone)
   values(p_business, c.instagram_participant_id, c.whatsapp_participant_id, c.participant_username, v_name, v_phone) returning id into cid;
 else
  -- Fill only what the customer record is missing; saved details are never overwritten.
  update customers set phone = coalesce(customers.phone, v_phone), display_name = coalesce(customers.display_name, v_name), updated_at = now()
   where id = cid and (customers.phone is null or customers.display_name is null);
 end if;
 update conversations set customer_id = cid, updated_at = now() where id = c.id and customer_id is distinct from cid;

 insert into orders(business_id, conversation_id, customer_id, status, currency, total_amount, payload)
  values(p_business, c.id, cid, 'confirmed', p.currency, total, jsonb_build_object(
   'source', 'manual', 'requestKey', p_request_key, 'createdBy', p_user,
   'product_id', p.id, 'product_name', p.name, 'variant_id', v.id, 'variant', v.options, 'quantity', p_quantity, 'unit', p.price_unit,
   'customer', jsonb_build_object('name', v_name, 'phone', v_phone,
     'city', nullif(btrim(p_customer->>'city'), ''), 'address', nullif(btrim(p_customer->>'address'), '')),
   'note', nullif(btrim(coalesce(p_note, '')), '')))
  returning id into oid;
 insert into order_items(order_id, product_id, variant_id, quantity, options, unit_amount)
  values(oid, p.id, v.id, p_quantity, coalesce(v.options, '{}'::jsonb), unit);
 return oid;
end $$;
revoke all on function public.create_manual_order(uuid,uuid,uuid,uuid,numeric,jsonb,text,text,uuid) from public, anon, authenticated;
grant execute on function public.create_manual_order(uuid,uuid,uuid,uuid,numeric,jsonb,text,text,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
