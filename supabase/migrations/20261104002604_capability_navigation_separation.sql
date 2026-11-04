-- Separate standard capabilities from presentation. Existing membership/RLS,
-- action role settings, business.provision restrictions and confirmation fences remain.
-- No business rows, active flags, workflow versions or conversations are rewritten.
begin;
create or replace function public.business_module_allowed(p_business uuid,p_module text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from businesses where id=p_business)
 and p_module=any(array['dashboard','inbox','products','services','orders','bookings','calendar','staff','catalogs','leads','customers','agents','knowledge','workflows','sources','instagram','whatsapp','settings'])
$$;

-- Internal presentation query. Never returned to an unauthenticated client.
create function public.business_used_modules(p_business uuid) returns text[]
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(array_agg(module),array[]::text[]) from (
  select 'products' as module where exists(select 1 from products where business_id=p_business)
  union all select 'services' where exists(select 1 from booking_services where business_id=p_business)
  union all select 'orders' where exists(select 1 from orders where business_id=p_business)
  union all select 'bookings' where exists(select 1 from bookings where business_id=p_business)
  union all select 'calendar' where exists(select 1 from business_calendar_settings where business_id=p_business)
  union all select 'catalogs' where exists(select 1 from catalogs where business_id=p_business)
  union all select 'knowledge' where exists(select 1 from knowledge_entries where business_id=p_business)
  union all select 'customers' where exists(select 1 from customers where business_id=p_business)
  union all select 'workflows' where exists(select 1 from visual_workflows where business_id=p_business)
 ) used
$$;
revoke all on function public.business_used_modules(uuid) from public,anon,authenticated;
grant execute on function public.business_used_modules(uuid) to service_role;

create or replace function public.can_execute_business_action(p_business uuid,p_user uuid,p_action text,p_automated boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare settings business_action_settings; member_role text;
begin
 if not exists(select 1 from businesses where id=p_business) then return false; end if;
 if p_action not in ('product.create','service.create') and not business_policy_allowed(p_business,p_action) then return false; end if;
 if p_action='product.create' and not business_module_allowed(p_business,'products') then return false; end if;
 if p_action='service.create' and not business_module_allowed(p_business,'services') then return false; end if;
 select * into settings from business_action_settings where business_id=p_business and action_key=p_action;
 if p_automated then return business_module_allowed(p_business,'workflows') and coalesce(settings.automation_allowed,false); end if;
 if p_user is null then return false; end if;
 if exists(select 1 from platform_admins where user_id=p_user) then return true; end if;
 select role into member_role from business_users where business_id=p_business and user_id=p_user;
 return case member_role when 'owner' then coalesce(settings.owner_allowed,true) when 'staff' then coalesce(settings.staff_allowed,p_action<>'business.provision') else false end;
end $$;

create or replace function public.save_business_modules(p_business uuid,p_user uuid,p_profile jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare m text; selected jsonb:=p_profile->'enabledModules';
begin
 if not exists(select 1 from platform_admins where user_id=p_user)
 and not exists(select 1 from business_users where business_id=p_business and user_id=p_user and role='owner') then raise exception 'unauthorized'; end if;
 perform 1 from businesses where id=p_business for update;
 if not found or jsonb_typeof(selected) is distinct from 'array' or p_profile->>'source' is distinct from 'manual' or p_profile->>'version' is distinct from '1' then raise exception 'invalid_profile'; end if;
 for m in select jsonb_array_elements_text(selected) loop
  if not business_module_allowed(p_business,m) then raise exception 'module_denied: %',m; end if;
 end loop;
 update businesses set dashboard_profile=p_profile,updated_at=now() where id=p_business;
end $$;
revoke all on function public.save_business_modules(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_business_modules(uuid,uuid,jsonb) to service_role;


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
  if not public.business_module_allowed(p_business,m) then raise exception 'module_disabled'; end if;
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
