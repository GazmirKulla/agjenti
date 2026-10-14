begin;
-- Existing modules stay available. Workspace selection remains in dashboard_profile;
-- only administrators can change entitlements through save_action_policy.
insert into public.platform_actions(key)
select 'module.' || m from unnest(array['products','services','orders','bookings','calendar','staff','catalogs','leads','customers','knowledge','workflows']) m;
insert into public.plan_actions(plan,action_key,enabled)
select p,a.key,true from unnest(array['free','starter','professional','enterprise']) p
cross join public.platform_actions a where a.key like 'module.%';

create function public.business_policy_allowed(p_business uuid,p_key text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select a.enabled and coalesce(o.enabled,p.enabled,false)
 from platform_actions a
 join business_billing b on b.business_id=p_business
 left join plan_actions p on p.plan=b.plan and p.action_key=a.key
 left join business_actions o on o.business_id=p_business and o.action_key=a.key and (o.expires_at is null or o.expires_at>now())
 where a.key=p_key),false)
$$;
create function public.business_module_allowed(p_business uuid,p_module text) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from businesses where id=p_business) then return false; end if;
 if p_module=any(array['dashboard','inbox','agents','sources','instagram','whatsapp','settings']) then return true; end if;
 if not business_policy_allowed(p_business,'module.'||p_module) then return false; end if;
 if p_module='orders' then return business_module_allowed(p_business,'products'); end if;
 if p_module='bookings' then return business_module_allowed(p_business,'services'); end if;
 if p_module='calendar' then return business_module_allowed(p_business,'bookings'); end if;
 if p_module='staff' then return business_module_allowed(p_business,'services') or business_module_allowed(p_business,'bookings'); end if;
 return true;
end $$;
create function public.allowed_business_modules(p_business uuid) returns text[]
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(array_agg(m),array[]::text[]) from unnest(array['dashboard','inbox','products','services','orders','bookings','calendar','staff','catalogs','leads','customers','agents','knowledge','workflows','sources','instagram','whatsapp','settings']) m
 where business_module_allowed(p_business,m)
$$;

-- Retain existing role, package, automation and staff behavior.
create or replace function public.can_execute_business_action(p_business uuid,p_user uuid,p_action text,p_automated boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare settings business_action_settings; member_role text;
begin
 if not business_policy_allowed(p_business,p_action) then return false; end if;
 if p_action='product.create' and not business_module_allowed(p_business,'products') then return false; end if;
 if p_action='service.create' and not business_module_allowed(p_business,'services') then return false; end if;
 select * into settings from business_action_settings where business_id=p_business and action_key=p_action;
 if p_automated then return business_module_allowed(p_business,'workflows') and coalesce(settings.automation_allowed,false); end if;
 if p_user is null then return false; end if;
 if exists(select 1 from platform_admins where user_id=p_user) then return true; end if;
 select role into member_role from business_users where business_id=p_business and user_id=p_user;
 return case member_role when 'owner' then coalesce(settings.owner_allowed,true) when 'staff' then coalesce(settings.staff_allowed,p_action<>'business.provision') else false end;
end $$;
revoke all on function public.business_policy_allowed(uuid,text),public.business_module_allowed(uuid,text),public.allowed_business_modules(uuid),public.can_execute_business_action(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.allowed_business_modules(uuid),public.can_execute_business_action(uuid,uuid,text,boolean) to service_role;

-- Reject newly selected denied modules even through onboarding/assistant/direct writes.
-- Keep stored selections after revocation so data/configuration can be restored later.
create function public.guard_module_selection() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare m text;
begin
 if new.dashboard_profile is not distinct from old.dashboard_profile then return new; end if;
 if auth.uid() is not null and not is_platform_admin() and not exists(select 1 from business_users where business_id=new.id and user_id=auth.uid() and role='owner') then raise exception 'unauthorized'; end if;
 for m in select jsonb_array_elements_text(new.dashboard_profile->'enabledModules') loop
  if not coalesce(old.dashboard_profile->'enabledModules','[]'::jsonb) ? m
    and not business_module_allowed(new.id,m) then raise exception 'module_denied: %',m; end if;
 end loop;
 return new;
end $$;
create trigger module_selection_guard before update of dashboard_profile on public.businesses
 for each row execute function public.guard_module_selection();

-- Owner module selection is checked atomically with the write.
create function public.save_business_modules(p_business uuid,p_user uuid,p_profile jsonb) returns void
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
 if (selected ? 'orders' and not selected ? 'products')
 or (selected ? 'bookings' and not selected ? 'services')
 or (selected ? 'calendar' and not selected ? 'bookings')
 or (selected ? 'staff' and not selected ?| array['services','bookings']) then raise exception 'module_dependencies'; end if;
 update businesses set dashboard_profile=p_profile,updated_at=now() where id=p_business;
end $$;
revoke all on function public.save_business_modules(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_business_modules(uuid,uuid,jsonb) to service_role;

-- Defense at the write boundary, including service-role RPCs and background execution.
-- Policy restrictions do not delete data or change workspace preferences.
create function public.guard_module_write() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare tenant uuid; prior uuid;
begin
 -- A revocation must not lose the receipt of an already-dispatched order.
 -- Only mirror an existing ledger result; amounts, payload, identity and items
 -- remain immutable. The existing managed-order trigger still protects clients.
 if tg_table_name='orders' and tg_op='UPDATE' then
  if (to_jsonb(new)-array['status','external_system','external_order_id','updated_at']) =
     (to_jsonb(old)-array['status','external_system','external_order_id','updated_at'])
   and exists(select 1 from order_submissions s where s.order_id=old.id and s.business_id=old.business_id
    and s.external_order_id is not distinct from new.external_order_id
    and new.external_system is not distinct from case when s.status='accepted' then 'external'::text else null::text end
    and new.status=case s.status when 'accepted' then 'submitted' when 'rejected' then 'failed' when 'local_only' then 'confirmed' else 'pending_reconciliation' end) then return new; end if;
 end if;
 if tg_table_name='workflow_steps' then
  select business_id into tenant from workflows where id=case when tg_op='DELETE' then old.workflow_id else new.workflow_id end;
 elsif tg_table_name='order_items' then
  select business_id into tenant from orders where id=case when tg_op='DELETE' then old.order_id else new.order_id end;
 else
  if tg_op='DELETE' then tenant:=old.business_id; else tenant:=new.business_id; end if;
 end if;
 if exists(select 1 from businesses where id=tenant) and not business_module_allowed(tenant,tg_argv[0]) then
  raise exception 'module_denied: %',tg_argv[0];
 end if;
 if tg_op='UPDATE' then
  if tg_table_name='workflow_steps' then select business_id into prior from workflows where id=old.workflow_id;
  elsif tg_table_name='order_items' then select business_id into prior from orders where id=old.order_id;
  else prior:=old.business_id; end if;
  if prior is distinct from tenant and not business_module_allowed(prior,tg_argv[0]) then raise exception 'module_denied'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
do $$ declare item record;
begin
 for item in select * from (values
  ('products','products'),('booking_services','services'),('orders','orders'),('order_items','orders'),('workflow_steps','workflows'),
  ('bookings','bookings'),('business_calendar_settings','calendar'),('google_calendar_connections','calendar'),
  ('catalogs','catalogs'),('catalog_sections','catalogs'),('knowledge_entries','knowledge'),
  ('workflows','workflows'),('visual_workflows','workflows'),('visual_workflow_versions','workflows'),
  ('linear_workflow_versions','workflows'),('product_workflow_drafts','workflows')
 ) t(tbl,mod) loop
  execute format('create trigger module_entitlement_guard before insert or update or delete on public.%I for each row execute function public.guard_module_write(%L)',item.tbl,item.mod);
 end loop;
end $$;
-- Direct authenticated reads must respect the same module policy.
create function public.current_user_module_allowed(p_business uuid,p_module text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select (is_business_member(p_business) or is_platform_admin()) and business_module_allowed(p_business,p_module)
$$;
revoke all on function public.current_user_module_allowed(uuid,text) from public,anon;
grant execute on function public.current_user_module_allowed(uuid,text) to authenticated;
do $$ declare item record;
begin
 for item in select * from (values
  ('products','products'),('booking_services','services'),('orders','orders'),('bookings','bookings'),
  ('business_calendar_settings','calendar'),('google_calendar_connections','calendar'),
  ('catalogs','catalogs'),('catalog_sections','catalogs'),('knowledge_entries','knowledge'),
  ('workflows','workflows'),('visual_workflows','workflows'),('visual_workflow_versions','workflows'),
  ('linear_workflow_versions','workflows'),('product_workflow_drafts','workflows')
 ) t(tbl,mod) loop
  execute format('create policy module_entitlement_read on public.%I as restrictive for select to authenticated using (public.current_user_module_allowed(business_id,%L))',item.tbl,item.mod);
 end loop;
end $$;
create policy module_entitlement_read on public.order_items as restrictive for select to authenticated
 using (exists(select 1 from public.orders o where o.id=order_id and public.current_user_module_allowed(o.business_id,'orders')));
create policy module_entitlement_read on public.workflow_steps as restrictive for select to authenticated
 using (exists(select 1 from public.workflows w where w.id=workflow_id and public.current_user_module_allowed(w.business_id,'workflows')));
-- customers are also identities for Inbox, and leads/staff currently have no independent
-- write tables. Their management routes are gated without breaking inbound messages.
revoke all on function public.guard_module_selection(),public.guard_module_write() from public,anon,authenticated,service_role;
commit;
