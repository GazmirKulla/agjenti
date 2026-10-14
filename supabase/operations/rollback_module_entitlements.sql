-- Roll back application code together with this operation. Retains module policy
-- rows, invitations, preferences and memberships; no user data is deleted.
-- After rollback, the previous application does not enforce module entitlements.
begin;
drop trigger module_selection_guard on public.businesses;
do $$ declare t text;
begin
 foreach t in array array['products','booking_services','orders','order_items','workflow_steps','bookings','business_calendar_settings','google_calendar_connections','catalogs','catalog_sections','knowledge_entries','workflows','visual_workflows','visual_workflow_versions','linear_workflow_versions','product_workflow_drafts'] loop
  execute format('drop trigger module_entitlement_guard on public.%I',t);
  execute format('drop policy module_entitlement_read on public.%I',t);
 end loop;
end $$;
create or replace function public.can_execute_business_action(p_business uuid,p_user uuid,p_action text,p_automated boolean default false) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare allowed boolean; override business_actions; settings business_action_settings; member_role text;
begin
 if not exists(select 1 from platform_actions where key=p_action and enabled) then return false; end if;
 select pa.enabled into allowed from business_billing b join plan_actions pa on pa.plan=b.plan and pa.action_key=p_action where b.business_id=p_business;
 select * into override from business_actions where business_id=p_business and action_key=p_action and (expires_at is null or expires_at>now());
 if override.enabled is not null then allowed:=override.enabled; end if;
 if not coalesce(allowed,false) then return false; end if;
 select * into settings from business_action_settings where business_id=p_business and action_key=p_action;
 if p_automated then return coalesce(settings.automation_allowed,false); end if;
 if p_user is null then return false; end if;
 if exists(select 1 from platform_admins where user_id=p_user) then return true; end if;
 select role into member_role from business_users where business_id=p_business and user_id=p_user;
 return case member_role when 'owner' then coalesce(settings.owner_allowed,true) when 'staff' then coalesce(settings.staff_allowed,p_action<>'business.provision') else false end;
end $$;
drop function public.save_business_modules(uuid,uuid,jsonb);
drop function public.guard_module_selection();
drop function public.guard_module_write();
drop function public.current_user_module_allowed(uuid,text);
drop function public.allowed_business_modules(uuid);
drop function public.business_module_allowed(uuid,text);
drop function public.business_policy_allowed(uuid,text);
commit;
