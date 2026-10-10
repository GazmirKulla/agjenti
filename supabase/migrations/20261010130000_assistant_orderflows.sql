-- Copy-on-write product workflows and an idempotent, tenant-scoped assistant writer.
-- Old definitions remain available to conversations that already started.
begin;
create table if not exists public.assistant_workflow_changes (
 id uuid primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 action text not null,
 before_data jsonb,
 after_data jsonb not null,
 workflow_id uuid references public.workflows(id) on delete set null,
 created_at timestamptz not null default now()
);
alter table public.assistant_workflow_changes enable row level security;
drop policy if exists assistant_workflow_history_read on public.assistant_workflow_changes;
create policy assistant_workflow_history_read on public.assistant_workflow_changes for select to authenticated using (is_business_member(business_id) or is_platform_admin());
revoke all on public.assistant_workflow_changes from public,anon,authenticated,service_role;
grant select on public.assistant_workflow_changes to authenticated,service_role;

create or replace function public.assistant_orderflow_snapshot(p_business uuid,p_id uuid) returns jsonb
language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('id',w.id,'name',w.name,'steps',coalesce((select jsonb_agg(jsonb_build_object(
  'key',s.key,'kind',s.kind,'required',s.required,'label',case when jsonb_typeof(s.config->'label')='string' then s.config->>'label' else s.key end
 ) order by s.position) from workflow_steps s where s.workflow_id=w.id),'[]'::jsonb)) from workflows w where w.id=p_id and w.business_id=p_business
$$;
revoke all on function public.assistant_orderflow_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assistant_orderflow_snapshot(uuid,uuid) to service_role;

create or replace function public.apply_assistant_orderflow(p_business uuid,p_user uuid,p_request uuid,p_action text,p_before jsonb,p_values jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare previous assistant_workflow_changes; source_id uuid; target_id uuid; actual jsonb; step jsonb; item jsonb; item_id uuid; item_row products; ids uuid[]; current_ids uuid[]; idx integer:=0;
begin
 perform 1 from businesses where id=p_business for update;
 if not found or not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 if p_request is null or p_action is null or p_action not in ('orderflow_create','orderflow_update','orderflow_assign') or jsonb_typeof(p_values) is distinct from 'object' or octet_length(p_values::text)>100000 then raise exception 'invalid_request'; end if;
 select * into previous from assistant_workflow_changes where id=p_request;
 if found then
  if previous.business_id is distinct from p_business or previous.actor_id is distinct from p_user or previous.action is distinct from p_action or previous.before_data is distinct from p_before or previous.after_data is distinct from p_values then raise exception 'invalid_replay'; end if;
  return previous.workflow_id;
 end if;
 if (select catalog_source from businesses where id=p_business)='external' then raise exception 'external_catalog'; end if;
 -- Lock definitions and assignments during snapshot comparison and the atomic copy.
 lock table workflows,workflow_steps,products in share row exclusive mode;
 if p_action<>'orderflow_create' then
  source_id:=(p_before->>'id')::uuid;
  actual:=assistant_orderflow_snapshot(p_business,source_id);
  if actual is null or actual is distinct from p_before then raise exception 'stale_workflow'; end if;
 elsif p_before is not null then raise exception 'invalid_create'; end if;
 if jsonb_typeof(p_values->'name') is distinct from 'string' or length(btrim(p_values->>'name')) not between 1 and 120 or jsonb_typeof(p_values->'steps') is distinct from 'array' then raise exception 'invalid_definition'; end if;
 if jsonb_array_length(p_values->'steps') not between 1 and 24 then raise exception 'invalid_steps'; end if;
 if (select count(distinct s->>'key') from jsonb_array_elements(p_values->'steps') s)<>jsonb_array_length(p_values->'steps') then raise exception 'duplicate_step'; end if;
 for step in select * from jsonb_array_elements(p_values->'steps') loop
  if coalesce(step->>'key','')!~'^[a-zA-Z][a-zA-Z0-9_]{0,59}$' or step->>'key' in ('constructor','prototype','__proto__','choose_product','order_ready','catalog_context','product_query')
   or coalesce(step->>'kind','') not in ('text','choice','photo','confirm','customer') or step->'required' is distinct from 'true'::jsonb
   or jsonb_typeof(step->'label') is distinct from 'string' or length(btrim(step->>'label')) not between 1 and 300 then raise exception 'invalid_step'; end if;
 end loop;
 if (select count(*) from jsonb_array_elements(p_values->'steps') s where s->>'kind'='customer')<>1 or p_values->'steps'->-1->>'kind'<>'customer' then raise exception 'customer_must_be_last'; end if;
 if p_action='orderflow_assign' and (p_values->'steps' is distinct from p_before->'steps' or p_values->>'name' is distinct from p_before->>'name') then raise exception 'assignment_changes_definition'; end if;
 if jsonb_typeof(p_values->'products') is distinct from 'array' or jsonb_array_length(p_values->'products')>200 then raise exception 'invalid_products'; end if;
 select coalesce(array_agg((p->>'id')::uuid order by p->>'id'),array[]::uuid[]) into ids from jsonb_array_elements(p_values->'products') p;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) or (p_action='orderflow_assign' and cardinality(ids)=0) then raise exception 'invalid_products'; end if;
 if p_action='orderflow_update' and coalesce(p_values->>'scope','') not in ('all','selected') then raise exception 'invalid_scope'; end if;
 if p_values->>'scope'='all' then
  if source_id is null then raise exception 'invalid_scope'; end if;
  select coalesce(array_agg(id order by id::text),array[]::uuid[]) into current_ids from products where business_id=p_business and workflow_id=source_id;
  if current_ids is distinct from ids then raise exception 'stale_assignments'; end if;
 end if;
 for item in select * from jsonb_array_elements(p_values->'products') loop
  item_id:=(item->>'id')::uuid;
  select * into item_row from products where id=item_id and business_id=p_business;
  if not found or item_row.updated_at is distinct from (item->>'updated_at')::timestamptz or item_row.workflow_id is distinct from (item->>'workflow_id')::uuid then raise exception 'stale_product'; end if;
  if p_action='orderflow_update' and item_row.workflow_id is distinct from source_id then raise exception 'wrong_source_workflow'; end if;
 end loop;
 target_id:=case when p_action='orderflow_assign' then source_id else p_request end;
 if p_action<>'orderflow_assign' then
  insert into workflows(id,business_id,name) values(target_id,p_business,btrim(p_values->>'name'));
  for step in select * from jsonb_array_elements(p_values->'steps') loop
   insert into workflow_steps(workflow_id,key,kind,position,required,config) values(target_id,step->>'key',step->>'kind',idx,true,coalesce((select config from workflow_steps where workflow_id=source_id and key=step->>'key'),'{}'::jsonb)||jsonb_build_object('label',btrim(step->>'label')));
   idx:=idx+1;
  end loop;
 end if;
 update products set workflow_id=target_id,updated_at=clock_timestamp() where business_id=p_business and id=any(ids);
 insert into assistant_workflow_changes(id,business_id,actor_id,action,before_data,after_data,workflow_id) values(p_request,p_business,p_user,p_action,p_before,p_values,target_id);
 return target_id;
end $$;
revoke all on function public.apply_assistant_orderflow(uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_assistant_orderflow(uuid,uuid,uuid,text,jsonb,jsonb) to service_role;
commit;
