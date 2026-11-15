-- Agent orders use contract v2, the same as the owner's "Krijo porosi" (docs/plan-porosite-e-agjentit-v2.md, phase A).
--
-- * order_dispatch_payload builds the website request for one saved order; begin_order_dispatch and
--   submit_process_order both use it. The contract v1 keys (formatId, colorId, character) are gone:
--   every value is sent under the product's own keys from its catalog (products.external_spec).
-- * process_order_selection turns the agent's answers into that selection.
-- * submit_process_order (staff confirm the agent's order): order_items.selection is saved; without an
--   orders URL, for a product the website does not know, or with something missing, the order stays
--   local (local_only plus reason, field, line) instead of being sent; p_files carries the photos staff chose.
--   The agent's automatic local orders do not change.
--
-- Requires 20261115180000_manual_order_lines.sql. Rollback: recreate begin_order_dispatch from
-- 20261115180000_manual_order_lines.sql and submit_process_order(…,p_token uuid) from
-- 20261114200000_order_unit_quantities.sql, then drop the three functions added here.
begin;

-- The agent's answers (facts keyed by the product's own keys) as the item's selection: each choice
-- as the website's value id, each detail typed as the catalog declares it, the photos staff chose.
-- Returns {selection, missing?, invalid?}: the first required key without an answer, the first answer
-- that is not one of the declared values. The variant's own choices are left to the variant.
create or replace function public.process_order_selection(p_spec jsonb, p_variant product_variants, p_facts jsonb, p_files jsonb)
returns jsonb language plpgsql stable set search_path=public,pg_temp as $$
declare opt jsonb; fld jsonb; raw text; id text; val jsonb; opts jsonb:='{}'::jsonb; fields jsonb:='{}'::jsonb; files jsonb:='{}'::jsonb;
 missing text; invalid text; variant_keys text[]:=coalesce((select array_agg(k) from jsonb_object_keys(coalesce(p_variant.options,'{}'::jsonb)) k),'{}');
begin
 if p_spec is null then return jsonb_build_object('selection','{}'::jsonb); end if;
 if p_facts is null or jsonb_typeof(p_facts) is distinct from 'object' then p_facts:='{}'::jsonb; end if;
 if p_files is not null and exists(select 1 from jsonb_object_keys(p_files) k where not exists(
   select 1 from jsonb_array_elements(coalesce(p_spec->'fields','[]'::jsonb)) x where x->>'key'=k and x->>'type' in ('photo','file')))
  then raise exception 'invalid_selection'; end if;
 for opt in select value from jsonb_array_elements(coalesce(p_spec->'options','[]'::jsonb)) loop
  continue when opt->>'key' = any(variant_keys);
  raw:=nullif(btrim(coalesce(p_facts->>(opt->>'key'), p_facts->>('variant_'||(opt->>'key')), '')),'');
  if raw is null then
   if coalesce((opt->>'required')::boolean,true) then missing:=coalesce(missing,opt->>'key'); end if;
   continue;
  end if;
  select x->>'id' into id from jsonb_array_elements(coalesce(opt->'values','[]'::jsonb)) x
   where x->>'id'=raw or lower(btrim(x->>'name'))=lower(raw) order by (x->>'id'=raw) desc limit 1;
  if id is null then invalid:=coalesce(invalid,opt->>'key'); continue; end if;
  opts:=opts||jsonb_build_object(opt->>'key',id);
 end loop;
 for fld in select value from jsonb_array_elements(coalesce(p_spec->'fields','[]'::jsonb)) loop
  continue when coalesce(fld->>'appliesTo','item')<>'item';
  if fld->>'type' in ('photo','file') then
   val:=p_files->(fld->>'key');
   if val is not null and jsonb_typeof(val)='array' and jsonb_array_length(val)>0 then files:=files||jsonb_build_object(fld->>'key',val);
   elsif coalesce((fld->>'required')::boolean,false) or coalesce((fld->>'min')::integer,0)>0 then missing:=coalesce(missing,fld->>'key'); end if;
   continue;
  end if;
  val:=p_facts->(fld->>'key');
  if val is null or val='null'::jsonb or (jsonb_typeof(val)='string' and btrim(val#>>'{}')='') then
   if coalesce((fld->>'required')::boolean,false) then missing:=coalesce(missing,fld->>'key'); end if;
   continue;
  end if;
  raw:=btrim(val#>>'{}');
  if fld->>'type'='number' then
   if raw !~ '^-?\d{1,12}(\.\d{1,6})?$' then invalid:=coalesce(invalid,fld->>'key'); continue; end if;
   val:=to_jsonb(raw::numeric);
  elsif fld->>'type'='boolean' then
   if lower(raw) in ('true','po','yes','1') then val:='true'::jsonb; elsif lower(raw) in ('false','jo','no','0') then val:='false'::jsonb;
   else invalid:=coalesce(invalid,fld->>'key'); continue; end if;
  elsif fld->>'type'='choice' then
   select x->>'id' into id from jsonb_array_elements(coalesce(fld->'values','[]'::jsonb)) x
    where x->>'id'=raw or lower(btrim(x->>'name'))=lower(raw) order by (x->>'id'=raw) desc limit 1;
   if id is null then invalid:=coalesce(invalid,fld->>'key'); continue; end if;
   val:=to_jsonb(id);
  else val:=to_jsonb(raw);
  end if;
  fields:=fields||jsonb_build_object(fld->>'key',val);
 end loop;
 return jsonb_strip_nulls(jsonb_build_object('selection',jsonb_build_object('options',opts,'fields',fields,'files',files,'addons','[]'::jsonb),
  'missing',missing,'invalid',invalid));
end $$;
revoke all on function public.process_order_selection(jsonb,product_variants,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.process_order_selection(jsonb,product_variants,jsonb,jsonb) to service_role;

-- The request to the business website for one saved order (contract v2), used by every path that
-- sends orders: the owner's "Krijo porosi" and the agent's order that staff confirm. Read only.
-- Returns the payload, or {reason, line} when an item can't be sent (the whole order then stays here).
create or replace function public.order_dispatch_payload(p_business uuid, p_order uuid, p_source text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare o orders; it order_items; p products; v product_variants; c conversations;
 sel jsonb; opts jsonb; opt jsonb; files jsonb; f record; items jsonb:='[]'::jsonb; n integer:=0;
begin
 if p_source not in ('owner_manual','agent') then raise exception 'invalid_order_scope'; end if;
 select * into o from orders where id=p_order and business_id=p_business;
 if not found then raise exception 'submission_unavailable'; end if;
 for it in select * from order_items where order_id=o.id order by position nulls first, id loop
  n:=n+1;
  p:=null; v:=null; opts:='{}'::jsonb; files:='[]'::jsonb;
  select * into p from products where id=it.product_id and business_id=p_business;
  if not found or p.source is distinct from 'linked' or p.external_id is null then
   return jsonb_build_object('reason','unmapped_product','line',n);
  end if;
  -- Never refreshed from the website: its ids and required data are unknown, so nothing is sent.
  if p.external_spec is null then return jsonb_build_object('reason','not_synced','line',n); end if;
  if it.variant_id is not null then
   select * into v from product_variants where id=it.variant_id and business_id=p_business;
   if v.external_id is null then return jsonb_build_object('reason','unmapped_variant','line',n); end if;
  end if;
  -- Orders from before lines kept the selection on the order.
  sel:=coalesce(it.selection, o.payload->'selection', '{}'::jsonb);
  if jsonb_typeof(sel) is distinct from 'object' then sel:='{}'::jsonb; end if;
  -- The variant's choices as the website's value ids, then the other choices as chosen.
  for opt in select value from jsonb_array_elements(coalesce(p.external_spec->'options','[]'::jsonb)) loop
   if v.options ? (opt->>'key') then
    opts:=opts||jsonb_build_object(opt->>'key',(select x->>'id' from jsonb_array_elements(opt->'values') x where x->>'name'=v.options->>(opt->>'key') limit 1));
   end if;
  end loop;
  opts:=opts||coalesce(sel->'options','{}'::jsonb);
  for f in select e.key, x.value as path from jsonb_each(coalesce(sel->'files','{}'::jsonb)) e, jsonb_array_elements_text(e.value) x loop
   files:=files||jsonb_build_array(jsonb_build_object('key',f.key,'path',f.path));
  end loop;
  items:=items||jsonb_build_array(jsonb_build_object(
   'productId',p.external_id,'variantId',v.external_id,'options',opts,'addons',coalesce(sel->'addons','[]'::jsonb),
   'fields',coalesce(sel->'fields','{}'::jsonb),'files',files,'quantity',it.quantity,'unitAmount',it.unit_amount,
   'currency',o.currency));
 end loop;
 if n=0 then return jsonb_build_object('reason','unmapped_product'); end if;
 select * into c from conversations where id=o.conversation_id and business_id=p_business;
 return jsonb_build_object('version',2,'channel',c.channel,'source',p_source,
  'customer',o.payload->'customer','fields','{}'::jsonb,'note',o.payload->'note','currency',o.currency,'expectedTotal',o.total_amount,
  'items',items);
end $$;
revoke all on function public.order_dispatch_payload(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.order_dispatch_payload(uuid,uuid,text) to service_role;

create or replace function public.begin_order_dispatch(p_business uuid, p_user uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; prior order_submissions; tid uuid; url text; built jsonb;
begin
 perform assert_business_member(p_business, p_user);
 select * into o from orders where id=p_order and business_id=p_business for update;
 if not found or o.payload->>'source' is distinct from 'manual' then raise exception 'submission_unavailable'; end if;
 select * into prior from order_submissions where order_id=o.id;
 if found then
  return jsonb_build_object('orderId',o.id,'attemptId',prior.attempt_id,'status',prior.status,'externalOrderId',prior.external_order_id,'dispatch',false);
 end if;
 select nullif(btrim(orders_url),'') into url from integrations where business_id=p_business and kind='http';
 if url is null then return jsonb_build_object('orderId',o.id,'status','local_only','dispatch',false); end if;
 built:=order_dispatch_payload(p_business,o.id,'owner_manual');
 if built ? 'reason' then return jsonb_build_object('orderId',o.id,'status','local_only','dispatch',false)||built; end if;
 insert into order_submissions(order_id,business_id,conversation_id,confirmation_id,confirmation,state_revision,created_by,executor_kind)
  values(o.id,p_business,o.conversation_id,o.id,jsonb_build_object('source','manual','requestKey',o.payload->>'requestKey'),0,p_user,'owner')
  returning attempt_id into tid;
 update orders set status='pending_reconciliation', updated_at=now() where id=o.id;
 return jsonb_build_object('orderId',o.id,'attemptId',tid,'status','pending_reconciliation','dispatch',true,'payload',built);
end $$;
revoke all on function public.begin_order_dispatch(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_order_dispatch(uuid,uuid,uuid) to service_role;

-- p_files is added; the old signature goes so the RPC call stays unambiguous.
drop function if exists public.submit_process_order(uuid,uuid,integer,uuid,uuid,bigint,uuid);
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
