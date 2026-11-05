begin;
-- Only server-owned policy can authorize customer-agent writes. Dashboard
-- navigation, model output and client updates to businesses cannot grant it.
create table public.business_automation_policies (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 local_orders boolean not null default false,
 revision integer not null default 1,
 authorized_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
alter table public.business_automation_policies enable row level security;
revoke all on public.business_automation_policies from public,anon,authenticated;
grant all on public.business_automation_policies to service_role;

create function public.configure_business_automation(p_business uuid,p_user uuid,p_enabled boolean,p_revision integer)
returns integer language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare current_revision integer; result integer;
begin
 perform 1 from public.businesses where id=p_business for update;
 if not found or not (exists(select 1 from public.business_users where business_id=p_business and user_id=p_user and role='owner')
   or exists(select 1 from public.platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 if not public.business_module_allowed(p_business,'orders') then raise exception 'module_disabled'; end if;
 select revision into current_revision from public.business_automation_policies where business_id=p_business;
 if coalesce(current_revision,0) is distinct from p_revision then raise exception 'stale_policy'; end if;
 insert into public.business_automation_policies(business_id,local_orders,authorized_by)
 values(p_business,p_enabled,p_user) on conflict(business_id) do update set local_orders=excluded.local_orders,
 authorized_by=excluded.authorized_by,revision=business_automation_policies.revision+1,updated_at=now() returning revision into result;
 return result;
end $$;
revoke all on function public.configure_business_automation(uuid,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.configure_business_automation(uuid,uuid,boolean,integer) to service_role;

-- Null creator denotes the customer-agent executor, never an impersonated owner.
alter table public.order_submissions alter column created_by drop not null;
alter table public.order_submissions add column executor_kind text not null default 'owner' check(executor_kind in ('owner','customer_agent'));
create or replace function public.submit_confirmed_order_internal(
  p_business uuid,p_user uuid,p_conversation uuid,p_revision integer,
  p_collected jsonb,p_order jsonb,p_enforce_modules boolean,p_automated boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  c public.conversations; s public.conversation_states; b public.businesses; p public.products; prior public.order_submissions;
  review jsonb:=p_order#>'{context,execution,orderReview}';
  terms jsonb:=p_order#>'{context,execution,orderTerms}';
  cid uuid; oid uuid; tid uuid; type_key text; review_id uuid; request_payload jsonb;
begin
  if p_automated then
    if p_user is not null then raise exception 'unauthorized'; end if;
    perform 1 from public.business_automation_policies where business_id=p_business and local_orders for share;
    if not found then raise exception 'automation_not_authorized'; end if;
  else
    perform public.assert_order_actor(p_business,p_user);
  end if;
  select * into c from public.conversations where id=p_conversation and business_id=p_business for update;
  if not found then raise exception 'conversation_unavailable'; end if;
  if p_automated and not coalesce(c.auto_reply,true) then raise exception 'automation_paused'; end if;
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
  if p_automated and not coalesce(b.auto_reply,false) then raise exception 'automation_paused'; end if;
  -- Navigation preferences never authorize or block order execution.
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
  insert into public.order_submissions(order_id,business_id,conversation_id,confirmation_id,confirmation,state_revision,created_by,executor_kind)
    values(oid,p_business,c.id,review_id,review,s.revision,p_user,case when p_automated then 'customer_agent' else 'owner' end) returning attempt_id into tid;
  -- Do not overwrite a booking/service cursor, canonical facts or pinned versions.
  if s.collected->>'step_key'='order_ready' and s.collected->>'product_id'=p.id::text
    and coalesce(s.collected#>>'{context,execution,factOwner}','order')='order' then
    update public.conversation_states set status='submitted',revision=revision+1,updated_at=now() where conversation_id=c.id and business_id=p_business;
  end if;
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
revoke all on function public.submit_confirmed_order_internal(uuid,uuid,uuid,integer,jsonb,jsonb,boolean,boolean) from public,anon,authenticated,service_role;
create or replace function public.submit_confirmed_order(p_business uuid,p_user uuid,p_conversation uuid,p_revision integer,p_collected jsonb,p_order jsonb,p_enforce_modules boolean)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select public.submit_confirmed_order_internal(p_business,p_user,p_conversation,p_revision,p_collected,p_order,p_enforce_modules,false);
$$;
create function public.submit_agent_confirmed_order(p_business uuid,p_conversation uuid,p_revision integer,p_collected jsonb,p_order jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select public.submit_confirmed_order_internal(p_business,null,p_conversation,p_revision,p_collected,p_order,true,true);
$$;
revoke all on function public.submit_agent_confirmed_order(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.submit_agent_confirmed_order(uuid,uuid,integer,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
