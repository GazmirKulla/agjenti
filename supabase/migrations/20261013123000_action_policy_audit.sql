begin;
create function public.save_action_policy(p_user uuid,p_scope text,p_target text,p_action text,p_enabled boolean,p_limit integer default null,p_expires date default null) returns void
language plpgsql security definer set search_path=public as $$
declare expires timestamptz:=case when p_expires is null then null else (p_expires+1)::timestamp at time zone 'Europe/Tirane' end;
begin
 if not exists(select 1 from platform_admins where user_id=p_user) then raise exception 'unauthorized'; end if;
 if not exists(select 1 from platform_actions where key=p_action) or (p_limit is not null and p_limit<0) then raise exception 'invalid_policy'; end if;
 if p_scope='global' then
  if p_enabled is null then raise exception 'invalid_policy'; end if;
  update platform_actions set enabled=p_enabled where key=p_action;
 elsif p_scope='plan' then
  if p_enabled is null then raise exception 'invalid_policy'; end if;
  insert into plan_actions(plan,action_key,enabled,monthly_limit) values(p_target,p_action,p_enabled,p_limit)
  on conflict(plan,action_key) do update set enabled=excluded.enabled,monthly_limit=excluded.monthly_limit;
 elsif p_scope='business' then
  perform 1 from businesses where id=p_target::uuid for update;
  if not found then raise exception 'invalid_business'; end if;
  insert into business_actions(business_id,action_key,enabled,monthly_limit,expires_at) values(p_target::uuid,p_action,p_enabled,p_limit,expires)
  on conflict(business_id,action_key) do update set enabled=excluded.enabled,monthly_limit=excluded.monthly_limit,expires_at=excluded.expires_at;
 else raise exception 'invalid_scope'; end if;
 insert into action_policy_events(actor_id,scope,target,action_key,changes) values(p_user,p_scope,p_target,p_action,jsonb_build_object('enabled',p_enabled,'monthlyLimit',p_limit,'expiresAt',expires));
end $$;
create function public.save_business_action_settings(p_business uuid,p_user uuid,p_action text,p_staff boolean,p_automation boolean,p_days integer) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from platform_admins where user_id=p_user) and not exists(select 1 from business_users where business_id=p_business and user_id=p_user and role='owner') then raise exception 'unauthorized'; end if;
 if p_action<>'business.provision' and p_automation then raise exception 'unsupported_automation'; end if;
 perform 1 from businesses where id=p_business for update;
 insert into business_action_settings(business_id,action_key,owner_allowed,staff_allowed,automation_allowed,invitation_days) values(p_business,p_action,true,p_staff,p_automation,p_days)
 on conflict(business_id,action_key) do update set owner_allowed=true,staff_allowed=excluded.staff_allowed,automation_allowed=excluded.automation_allowed,invitation_days=excluded.invitation_days;
 insert into action_policy_events(actor_id,scope,target,action_key,changes) values(p_user,'settings',p_business::text,p_action,jsonb_build_object('staffAllowed',p_staff,'automationAllowed',p_automation,'invitationDays',p_days));
end $$;
revoke all on function public.save_action_policy(uuid,text,text,text,boolean,integer,date),public.save_business_action_settings(uuid,uuid,text,boolean,boolean,integer) from public,anon,authenticated;
grant execute on function public.save_action_policy(uuid,text,text,text,boolean,integer,date),public.save_business_action_settings(uuid,uuid,text,boolean,boolean,integer) to service_role;
commit;
