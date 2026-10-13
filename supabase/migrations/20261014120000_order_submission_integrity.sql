-- W4. Additive ledger; no backfill, no historical snapshot changes.
-- Apply only after staging verification. Application must not fall back to split inserts.
begin;
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('draft','confirmed','submitted','failed','pending_reconciliation'));

create table public.order_submissions (
  order_id uuid primary key references public.orders(id) on delete restrict,
  business_id uuid not null references public.businesses(id),
  conversation_id uuid not null,
  confirmation_id uuid not null,
  confirmation jsonb not null,
  state_revision integer not null,
  attempt_id uuid not null unique default gen_random_uuid(),
  status text not null default 'pending_reconciliation'
    check(status in ('pending_reconciliation','local_only','accepted','rejected')),
  external_order_id text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  reconciled_by uuid,
  reconciliation_evidence text,
  unique(business_id,conversation_id,confirmation_id)
);
alter table public.order_submissions enable row level security;
revoke all on public.order_submissions from public,anon,authenticated;
grant all on public.order_submissions to service_role;

-- Existing authenticated RLS paths may still manage legacy orders, but cannot erase
-- or edit managed receipts/items and thereby bypass W4. Privileged retention needs
-- a separate explicit policy; ledger FKs deliberately prevent casual deletion.
create function public.protect_managed_order() returns trigger
language plpgsql security definer set search_path=public as $$
declare old_order uuid; new_order uuid;
begin
  if current_setting('role',true) in ('authenticated','anon')
    or coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
      nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') in ('authenticated','anon') then
    if TG_TABLE_NAME='orders' then
      old_order:=old.id;
      if TG_OP<>'DELETE' then new_order:=new.id; end if;
    else
      if TG_OP<>'INSERT' then old_order:=old.order_id; end if;
      if TG_OP<>'DELETE' then new_order:=new.order_id; end if;
    end if;
    if exists(select 1 from order_submissions where order_id in(old_order,new_order)) then
      raise exception 'managed_order_immutable';
    end if;
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;
create trigger protect_managed_order before update or delete on public.orders
  for each row execute function public.protect_managed_order();
create trigger protect_managed_order_items before insert or update or delete on public.order_items
  for each row execute function public.protect_managed_order();

-- Same actor/membership authority as the API, rechecked within the transaction.
create function public.assert_order_actor(p_business uuid,p_user uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if p_user is null then raise exception 'unauthorized'; end if;
  perform 1 from platform_admins where user_id=p_user for key share;
  if found then return; end if;
  perform 1 from business_users where business_id=p_business and user_id=p_user for key share;
  if not found then raise exception 'unauthorized'; end if;
end $$;

create function public.submit_confirmed_order(
  p_business uuid,p_user uuid,p_conversation uuid,p_revision integer,
  p_collected jsonb,p_order jsonb,p_enforce_modules boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c conversations; s conversation_states; b businesses; p products; prior order_submissions;
  review jsonb:=p_order#>'{context,execution,orderReview}';
  terms jsonb:=p_order#>'{context,execution,orderTerms}';
  cid uuid; oid uuid; tid uuid; type_key text; review_id uuid; request_payload jsonb;
begin
  perform assert_order_actor(p_business,p_user);
  select * into c from conversations where id=p_conversation and business_id=p_business for update;
  if not found then raise exception 'conversation_unavailable'; end if;
  review_id:=(review->>'id')::uuid;
  if review_id is null then raise exception 'confirmation_required'; end if;
  select * into prior from order_submissions where business_id=p_business and conversation_id=p_conversation
    and confirmation_id=review_id;
  if found then
    if prior.confirmation is distinct from review then raise exception 'confirmation_conflict'; end if;
    return jsonb_build_object('orderId',prior.order_id,'attemptId',prior.attempt_id,'status',prior.status,
      'externalOrderId',prior.external_order_id,'dispatch',false);
  end if;
  select * into s from conversation_states where conversation_id=p_conversation and business_id=p_business for update;
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
  select * into b from businesses where id=p_business for share;
  -- Explicit module settings apply at this final side-effect boundary even outside
  -- the workflow rollout. Legacy absent profiles keep the existing rollout switch.
  if p_enforce_modules or (b.dashboard_profile is not null and b.dashboard_profile->>'source' is distinct from 'legacy') then
    if not coalesce((b.dashboard_profile->'enabledModules') @> '["orders","products"]'::jsonb,false)
      then raise exception 'module_disabled'; end if;
  end if;
  select * into p from products where id=(p_order->>'product_id')::uuid and business_id=p_business and is_active for share;
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
    select coalesce(external_key,id::text) into type_key from product_types where id=p.product_type_id and is_active for share;
    if not found then raise exception 'product_unavailable'; end if;
  end if;
  if nullif(trim(p_order#>>'{customer,name}'),'') is null or nullif(trim(p_order#>>'{customer,phone}'),'') is null
    or nullif(trim(p_order#>>'{customer,address}'),'') is null then raise exception 'customer_required'; end if;
  if coalesce(p_order#>>'{fields,quantity}','1')<>'1' or coalesce(p_order#>>'{fields,collect_quantity}','1')<>'1'
    then raise exception 'unsupported_order_scope'; end if;
  cid:=c.customer_id;
  if cid is not null then
    perform 1 from customers where id=cid and business_id=p_business for share;
    if not found then raise exception 'customer_unavailable'; end if;
  elsif c.whatsapp_participant_id is not null then
    insert into customers(business_id,whatsapp_user_id,display_name,phone)
      values(p_business,c.whatsapp_participant_id,p_order#>>'{customer,name}',p_order#>>'{customer,phone}')
      on conflict(business_id,whatsapp_user_id) where whatsapp_user_id is not null
      do update set display_name=excluded.display_name,phone=excluded.phone,updated_at=now() returning id into cid;
  elsif c.instagram_participant_id is not null then
    insert into customers(business_id,instagram_user_id,username,display_name,phone)
      values(p_business,c.instagram_participant_id,c.participant_username,p_order#>>'{customer,name}',p_order#>>'{customer,phone}')
      on conflict(business_id,instagram_user_id) where instagram_user_id is not null
      do update set display_name=excluded.display_name,phone=excluded.phone,updated_at=now() returning id into cid;
  else
    insert into customers(business_id,display_name,phone)
      values(p_business,p_order#>>'{customer,name}',p_order#>>'{customer,phone}') returning id into cid;
  end if;
  update conversations set customer_id=cid,updated_at=now() where id=c.id;
  insert into orders(business_id,conversation_id,customer_id,status,currency,total_amount,payload)
    values(p_business,c.id,cid,'pending_reconciliation',p.currency,p.price_amount,p_order) returning id into oid;
  insert into order_items(order_id,product_id,product_type_key,external_format_id,quantity,options,unit_amount)
    values(oid,p.id,type_key,p_order#>>'{fields,collect_size}',1,coalesce(p_order->'fields','{}'),p.price_amount);
  insert into order_submissions(order_id,business_id,conversation_id,confirmation_id,confirmation,state_revision,created_by)
    values(oid,p_business,c.id,review_id,review,s.revision,p_user) returning attempt_id into tid;
  -- Do not overwrite a booking/service cursor, canonical facts or pinned versions.
  if s.collected->>'step_key'='order_ready' and s.collected->>'product_id'=p.id::text
    and coalesce(s.collected#>>'{context,execution,factOwner}','order')='order' then
    update conversation_states set status='submitted',revision=revision+1,updated_at=now() where conversation_id=c.id and business_id=p_business;
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

create function public.finish_order_submission(p_business uuid,p_order uuid,p_attempt uuid,p_status text,p_external text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior order_submissions;
begin
  if p_status not in ('local_only','accepted','rejected','pending_reconciliation') then raise exception 'invalid_result'; end if;
  select * into prior from order_submissions where order_id=p_order and business_id=p_business and attempt_id=p_attempt for update;
  if not found then raise exception 'submission_unavailable'; end if;
  if prior.status<>'pending_reconciliation' then
    if prior.status is distinct from p_status or prior.external_order_id is distinct from p_external then raise exception 'result_conflict'; end if;
  else
    update order_submissions set status=p_status,external_order_id=p_external,
      resolved_at=case when p_status='pending_reconciliation' then null else now() end where order_id=p_order;
    update orders set status=case p_status when 'accepted' then 'submitted' when 'rejected' then 'failed'
      when 'local_only' then 'confirmed' else 'pending_reconciliation' end,
      external_system=case when p_status='accepted' then 'external' else null end,external_order_id=p_external,updated_at=now()
      where id=p_order and business_id=p_business;
  end if;
  return jsonb_build_object('orderId',p_order,'attemptId',p_attempt,'status',p_status,'externalOrderId',p_external,'dispatch',false);
end $$;

-- Staff verifies the provider's records first. This records evidence, NEVER resends.
create function public.reconcile_order_submission(p_business uuid,p_user uuid,p_conversation uuid,p_order uuid,p_status text,p_external text,p_evidence text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior order_submissions; result jsonb;
begin
  perform assert_order_actor(p_business,p_user);
  if p_status not in ('accepted','rejected') or length(trim(coalesce(p_evidence,'')))<12 or length(p_evidence)>1000
    or (p_status='accepted' and nullif(trim(p_external),'') is null) or length(p_external)>200 then raise exception 'reconciliation_evidence_required'; end if;
  select * into prior from order_submissions where order_id=p_order and business_id=p_business and conversation_id=p_conversation for update;
  if not found then raise exception 'submission_unavailable'; end if;
  if prior.status<>'pending_reconciliation' then raise exception 'result_conflict'; end if;
  if prior.created_at>clock_timestamp()-interval '1 minute' then raise exception 'submission_in_flight'; end if;
  result:=finish_order_submission(p_business,p_order,prior.attempt_id,p_status,p_external);
  update order_submissions set reconciled_by=p_user,reconciliation_evidence=trim(p_evidence) where order_id=p_order;
  return result;
end $$;

revoke all on function public.protect_managed_order(),public.assert_order_actor(uuid,uuid),
  public.submit_confirmed_order(uuid,uuid,uuid,integer,jsonb,jsonb,boolean),
  public.finish_order_submission(uuid,uuid,uuid,text,text),
  public.reconcile_order_submission(uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.assert_order_actor(uuid,uuid),
  public.submit_confirmed_order(uuid,uuid,uuid,integer,jsonb,jsonb,boolean),
  public.finish_order_submission(uuid,uuid,uuid,text,text),
  public.reconcile_order_submission(uuid,uuid,uuid,uuid,text,text,text) to service_role;
commit;
