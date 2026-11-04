begin;
alter table public.products add column archived_at timestamptz;
alter table public.products add constraint archived_products_inactive check (archived_at is null or not is_active);

create function public.assert_business_operator(p_business uuid,p_user uuid) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if p_user is null or not exists(select 1 from public.businesses where id=p_business)
 or (not exists(select 1 from public.business_users where business_id=p_business and user_id=p_user)
 and not exists(select 1 from public.platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
end $$;
revoke all on function public.assert_business_operator(uuid,uuid) from public,anon,authenticated,service_role;

create function public.protect_product_history() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not exists(select 1 from public.businesses where id=old.business_id) then return old; end if;
 if exists(select 1 from public.order_items where product_id=old.id)
 or exists(select 1 from public.product_workflow_drafts where product_id=old.id)
 or exists(select 1 from public.visual_workflow_versions where business_id=old.business_id and position(old.id::text in graph::text)>0)
 or exists(select 1 from public.visual_workflows where business_id=old.business_id and position(old.id::text in draft::text)>0)
 or exists(select 1 from public.conversation_states where business_id=old.business_id and position(old.id::text in collected::text)>0)
 then raise exception 'product_has_history'; end if;
 return old;
end $$;
revoke all on function public.protect_product_history() from public,anon,authenticated,service_role;
create trigger protect_product_history before delete on public.products for each row execute function public.protect_product_history();

create function public.product_lifecycle(p_business uuid,p_user uuid,p_product uuid,p_expected timestamptz,p_operation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p public.products; b public.businesses;
begin
 perform public.assert_business_operator(p_business,p_user);
 select * into b from public.businesses where id=p_business for share;
 if b.catalog_source='external' then raise exception 'external_catalog'; end if;
 select * into p from public.products where business_id=p_business and id=p_product for update;
 if not found or p.updated_at is distinct from p_expected then raise exception 'stale_product'; end if;
 if p_operation='delete' then
  delete from public.products where id=p.id;
 elsif p_operation in ('archive','restore') then
  update public.products set archived_at=case when p_operation='archive' then clock_timestamp() else null end,
   is_active=false,updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond') where id=p.id;
 else raise exception 'invalid_operation'; end if;
 return jsonb_build_object('id',p.id,'operation',p_operation);
end $$;
revoke all on function public.product_lifecycle(uuid,uuid,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.product_lifecycle(uuid,uuid,uuid,timestamptz,text) to service_role;

create function public.save_managed_agent(p_business uuid,p_user uuid,p_id uuid,p_before jsonb,p_active uuid[],p_values jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.ai_agents; current_active uuid[]; created uuid;
begin
 perform public.assert_business_operator(p_business,p_user);
 perform 1 from public.businesses where id=p_business for update;
 select coalesce(array_agg(id order by id),array[]::uuid[]) into current_active from public.ai_agents where business_id=p_business and is_active;
 if current_active is distinct from p_active then raise exception 'stale_agent'; end if;
 if length(trim(p_values->>'name')) not between 1 and 120 or length(trim(p_values->>'instructions')) not between 1 and 8000
 or p_values->>'is_active' not in ('true','false') or not p_values ?& array['name','instructions','is_active'] then raise exception 'invalid_agent'; end if;
 if p_before is not null then
  select * into a from public.ai_agents where business_id=p_business and id=p_id for update;
  if not found or a.updated_at is distinct from (p_before->>'updated_at')::timestamptz
   or a.instructions is distinct from p_before->>'instructions' then raise exception 'stale_agent'; end if;
 end if;
 if (p_values->>'is_active')::boolean then
  update public.ai_agents set is_active=false,updated_at=clock_timestamp() where business_id=p_business and is_active and id<>p_id;
 end if;
 if p_before is null then
  insert into public.ai_agents(id,business_id,name,instructions,is_active) values(p_id,p_business,p_values->>'name',p_values->>'instructions',(p_values->>'is_active')::boolean) returning id into created;
 else
  update public.ai_agents set name=p_values->>'name',instructions=p_values->>'instructions',is_active=(p_values->>'is_active')::boolean,
   updated_at=greatest(clock_timestamp(),a.updated_at+interval '1 microsecond') where id=p_id returning id into created;
 end if;
 return created;
end $$;
revoke all on function public.save_managed_agent(uuid,uuid,uuid,jsonb,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.save_managed_agent(uuid,uuid,uuid,jsonb,uuid[],jsonb) to service_role;

create function public.save_calendar_configuration(p_business uuid,p_user uuid,p_before jsonb,p_values jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare current_value jsonb;
begin
 perform public.assert_business_operator(p_business,p_user);
 perform 1 from public.businesses where id=p_business for update;
 select to_jsonb(s)-'updated_at'-'created_at'-'business_id' into current_value from public.business_calendar_settings s where business_id=p_business for update;
 if current_value is distinct from p_before then raise exception 'stale_calendar'; end if;
 insert into public.business_calendar_settings(business_id,timezone,hours,closed_dates,confirmation_mode,agent_booking_enabled)
 values(p_business,p_values->>'timezone',p_values->'hours',p_values->'closed_dates',p_values->>'confirmation_mode',(p_values->>'agent_booking_enabled')::boolean)
 on conflict(business_id) do update set timezone=excluded.timezone,hours=excluded.hours,closed_dates=excluded.closed_dates,
 confirmation_mode=excluded.confirmation_mode,agent_booking_enabled=excluded.agent_booking_enabled,updated_at=clock_timestamp();
end $$;
revoke all on function public.save_calendar_configuration(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_calendar_configuration(uuid,uuid,jsonb,jsonb) to service_role;

create function public.configure_product_batch(p_business uuid,p_user uuid,p_ids uuid[],p_expected jsonb,p_changes jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p public.products; n integer:=0; next_type uuid; next_active boolean;
begin
 perform public.assert_business_operator(p_business,p_user);
 if cardinality(p_ids) not between 1 and 100 or (select count(distinct x) from unnest(p_ids) x)<>cardinality(p_ids)
 or p_expected is null or p_changes is null or p_changes-'is_active'-'product_type_id'-'workflow_id'-'updated_at'<>'{}'::jsonb then raise exception 'invalid_batch'; end if;
 if exists(select 1 from public.businesses where id=p_business and catalog_source='external') then raise exception 'external_catalog'; end if;
 for p in select * from public.products where business_id=p_business and id=any(p_ids) order by id for update loop
  if p.archived_at is not null or p.updated_at is distinct from (p_expected->>p.id::text)::timestamptz then raise exception 'stale_product'; end if;
  next_type:=coalesce((p_changes->>'product_type_id')::uuid,p.product_type_id);
  next_active:=coalesce((p_changes->>'is_active')::boolean,p.is_active);
  if next_type is not null then
   perform 1 from public.product_types where id=next_type and (not next_active or is_active) for share;
   if not found then raise exception 'invalid_product_type'; end if;
  end if;
  if next_active and (next_type is null or p.price_amount is null or p.price_amount<0 or p.currency!~'^[A-Z]{3}$') then raise exception 'invalid_active_product'; end if;
  if p_changes ? 'workflow_id' then
   perform 1 from public.workflows where id=(p_changes->>'workflow_id')::uuid and business_id=p_business for share;
   if not found then raise exception 'invalid_workflow'; end if;
  end if;
  update public.products set product_type_id=next_type,is_active=next_active,
   workflow_id=case when p_changes ? 'workflow_id' then (p_changes->>'workflow_id')::uuid else p.workflow_id end,
   updated_at=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond') where id=p.id;
  n:=n+1;
 end loop;
 if n<>cardinality(p_ids) then raise exception 'invalid_batch_targets'; end if;
 return n;
end $$;
revoke all on function public.configure_product_batch(uuid,uuid,uuid[],jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.configure_product_batch(uuid,uuid,uuid[],jsonb,jsonb) to service_role;

create table public.business_operation_receipts (
 id uuid primary key, business_id uuid not null references public.businesses(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 operation text not null, state text not null check(state in ('running','completed','uncertain')),
 result jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.business_operation_receipts enable row level security;
revoke all on public.business_operation_receipts from public,anon,authenticated;
grant select on public.business_operation_receipts to authenticated;
grant all on public.business_operation_receipts to service_role;
create policy operation_owner_read on public.business_operation_receipts for select to authenticated
 using(user_id=(select auth.uid()) and public.is_business_member(business_id));
create function public.claim_business_operation(p_id uuid,p_business uuid,p_user uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare created uuid; receipt public.business_operation_receipts;
begin
 perform public.assert_business_operator(p_business,p_user);
 insert into public.business_operation_receipts(id,business_id,user_id,operation,state)
 values(p_id,p_business,p_user,p_operation,'running') on conflict(id) do nothing returning id into created;
 if created is not null then return jsonb_build_object('execute',true); end if;
 select * into receipt from public.business_operation_receipts where id=p_id;
 if receipt.business_id<>p_business or receipt.user_id<>p_user or receipt.operation<>p_operation then raise exception 'unauthorized'; end if;
 return jsonb_build_object('execute',false,'state',receipt.state,'result',receipt.result);
end $$;
revoke all on function public.claim_business_operation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_business_operation(uuid,uuid,uuid,text) to service_role;

create table public.business_operation_plans (
 id uuid primary key, business_id uuid not null references public.businesses(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, title text not null,
 fingerprint text not null, steps jsonb not null, state text not null default 'pending' check(state in ('pending','blocked','completed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.business_operation_plans enable row level security;
revoke all on public.business_operation_plans from public,anon,authenticated;
grant select on public.business_operation_plans to authenticated;
grant all on public.business_operation_plans to service_role;
create policy operation_plan_owner_read on public.business_operation_plans for select to authenticated
 using(user_id=(select auth.uid()) and public.is_business_member(business_id));
create table public.business_attention_preferences (
 business_id uuid not null references public.businesses(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 enabled boolean not null default false, last_items jsonb not null default '[]',
 checked_at timestamptz, last_attempt_at timestamptz, primary key(business_id,user_id)
);
create table public.business_attention_events (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, source_id text not null,
 title text not null, detail text not null, href text not null,
 created_at timestamptz not null default now(), acknowledged_at timestamptz
);
alter table public.business_attention_preferences enable row level security;
alter table public.business_attention_events enable row level security;
revoke all on public.business_attention_preferences, public.business_attention_events from public,anon,authenticated;
grant select on public.business_attention_preferences, public.business_attention_events to authenticated;
grant all on public.business_attention_preferences, public.business_attention_events to service_role;
create policy attention_preferences_owner_read on public.business_attention_preferences for select to authenticated
 using(user_id=(select auth.uid()) and public.is_business_member(business_id));
create policy attention_events_owner_read on public.business_attention_events for select to authenticated
 using(user_id=(select auth.uid()) and public.is_business_member(business_id));
create index attention_preferences_scan on public.business_attention_preferences(last_attempt_at nulls first) where enabled;
create index attention_events_user on public.business_attention_events(business_id,user_id,created_at desc);

create function public.configure_attention(p_business uuid,p_user uuid,p_enabled boolean,p_expected boolean) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare current_enabled boolean;
begin
 perform public.assert_business_operator(p_business,p_user);
 if p_enabled is null or p_expected is null then raise exception 'invalid_preference'; end if;
 insert into public.business_attention_preferences(business_id,user_id) values(p_business,p_user) on conflict do nothing;
 select enabled into current_enabled from public.business_attention_preferences where business_id=p_business and user_id=p_user for update;
 if current_enabled is distinct from p_expected then raise exception 'stale_preference'; end if;
 update public.business_attention_preferences set enabled=p_enabled where business_id=p_business and user_id=p_user;
end $$;
revoke all on function public.configure_attention(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.configure_attention(uuid,uuid,boolean,boolean) to service_role;

create function public.record_attention_check(p_business uuid,p_user uuid,p_items jsonb) returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare pref public.business_attention_preferences; item jsonb; n integer:=0;
begin
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then raise exception 'invalid_attention'; end if;
 select * into pref from public.business_attention_preferences where business_id=p_business and user_id=p_user and enabled for update;
 if not found or not exists(select 1 from public.business_users where business_id=p_business and user_id=p_user) then return 0; end if;
 for item in select jsonb_array_elements(p_items) loop
  if not exists(select 1 from jsonb_array_elements(pref.last_items) previous where previous=item) then
   insert into public.business_attention_events(business_id,user_id,source_id,title,detail,href)
   values(p_business,p_user,item->>'id',item->>'title',item->>'detail',item->>'href');
   n:=n+1;
  end if;
 end loop;
 update public.business_attention_preferences set last_items=p_items,checked_at=clock_timestamp() where business_id=p_business and user_id=p_user;
 return n;
end $$;
revoke all on function public.record_attention_check(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_attention_check(uuid,uuid,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
