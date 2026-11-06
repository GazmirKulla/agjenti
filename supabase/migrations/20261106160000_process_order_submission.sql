begin;
create function public.submit_process_order(
 p_business uuid,p_conversation uuid,p_revision integer,p_action uuid,p_user uuid,p_job bigint,p_token uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 c public.conversations; s public.conversation_states; b public.businesses; p public.products; prior public.order_submissions;
 job public.workflow_inbound_queue; instance jsonb; action jsonb; input jsonb; graph jsonb; flow jsonb;
 review jsonb; p_order jsonb; p_automated boolean:=p_user is null;
 cid uuid; oid uuid; tid uuid; type_key text; request_payload jsonb;
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
 select v.graph into graph from public.visual_workflow_versions v where v.business_id=p_business and v.id=(instance->>'versionId')::uuid;
 if graph is null then raise exception 'workflow_not_ready'; end if;
 if graph->>'version'='2' then
  select f into flow from jsonb_array_elements(graph->'flows') f where f->>'id'=instance->>'definitionId';
  if flow is null then raise exception 'workflow_not_ready'; end if;
  if jsonb_array_length(coalesce(flow->'productIds','[]'::jsonb))>0 and not (flow->'productIds' ? (input->>'productId')) then raise exception 'product_changed'; end if;
 end if;
 select * into p from public.products where business_id=p_business and id=(input->>'productId')::uuid and is_active for share;
 if not found then raise exception 'product_unavailable'; end if;
 if p.price_amount is null or p.price_amount<0 or p.currency!~'^[A-Z]{3}$'
  or input->>'productName' is distinct from p.name or (input->>'unitAmount')::numeric is distinct from p.price_amount
  or input->>'currency' is distinct from p.currency or input->>'quantity' is distinct from '1'
  or input->>'productTypeId' is distinct from coalesce(p.product_type_id::text,'none') then raise exception 'commercial_terms_changed'; end if;
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
  if not found then return jsonb_build_object('status','awaiting_staff','dispatch',false); end if;
 end if;
 -- Integration payload projection only; the process snapshot remains the only writable conversation state.
 p_order:=jsonb_build_object('product_id',p.id,'product_type_id',p.product_type_id,'fields',(input->>'options')::jsonb,
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
    values(p_business,c.id,cid,'pending_reconciliation',p.currency,p.price_amount,p_order) returning id into oid;
  insert into public.order_items(order_id,product_id,product_type_key,external_format_id,quantity,options,unit_amount)
    values(oid,p.id,type_key,p_order#>>'{fields,collect_size}',1,coalesce(p_order->'fields','{}'),p.price_amount);
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
    'currency',p.currency,'totalAmount',p.price_amount,'items',jsonb_build_array(jsonb_build_object(
      'productId',coalesce(p.external_id,p.id::text),'productType',type_key,
      'formatId',p_order#>'{fields,collect_size}','colorId',p_order#>'{fields,collect_color}',
      'character',p_order#>'{fields,collect_theme}','options',coalesce(p_order->'fields','{}'),
      'quantity',1,'unitAmount',p.price_amount,'currency',p.currency)));
  -- Only the transaction winner gets permission to dispatch. Losing this response
  -- also loses permission: a retry reads the ledger and requires reconciliation.
  return jsonb_build_object('orderId',oid,'attemptId',tid,'status','pending_reconciliation','dispatch',true,'payload',request_payload);
end $$;
revoke all on function public.submit_process_order(uuid,uuid,integer,uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.submit_process_order(uuid,uuid,integer,uuid,uuid,bigint,uuid) to service_role;
commit;
