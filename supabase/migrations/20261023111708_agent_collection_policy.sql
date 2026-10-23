-- Additive configuration only. No activation, publication or transaction changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.businesses add column agent_collection_policy jsonb;

-- A table-level UPDATE grant must not make this configuration client-writable.
-- INVOKER is intentional: only the owner-executed setter may change this column.
create function public.guard_agent_collection_policy() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if (tg_op='INSERT' and new.agent_collection_policy is not null)
   or (tg_op='UPDATE' and new.agent_collection_policy is distinct from old.agent_collection_policy) then
  if current_user<>(select pg_get_userbyid(relowner) from pg_class where oid='public.businesses'::regclass)
   then raise exception 'collection_policy_server_owned'; end if;
 end if;
 return new;
end $$;
create trigger agent_collection_policy_guard before insert or update on public.businesses
for each row execute function public.guard_agent_collection_policy();

create function public.save_agent_collection_policy(p_business uuid,p_user uuid,p_revision integer,p_scopes jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare old_revision integer; scope jsonb; g jsonb; f jsonb; domain text; next_revision integer;
begin
 select coalesce((agent_collection_policy->>'revision')::integer,0) into old_revision
 from public.businesses where id=p_business for update;
 if not found or p_user is null or not (
  exists(select 1 from public.business_users where business_id=p_business and user_id=p_user and role='owner')
  or exists(select 1 from public.platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 if p_revision is distinct from old_revision then raise exception 'stale_collection_policy'; end if;
 -- Configuration is an offline operation; no current run may change authority.
 -- The same business lock serializes publication/activation. No history is edited.
 if exists(select 1 from public.visual_workflows where business_id=p_business and enabled)
  then raise exception 'collection_configuration_requires_disabled_workflow'; end if;
 if exists(select 1 from public.workflow_inbound_queue where business_id=p_business and status in ('queued','processing','prepared','sending','uncertain'))
  then raise exception 'collection_configuration_busy'; end if;
 if jsonb_typeof(p_scopes) is distinct from 'array' or jsonb_array_length(p_scopes)>100 then raise exception 'invalid_collection_policy'; end if;
 if exists(select 1 from jsonb_array_elements(p_scopes) x group by x->>'versionId',x->>'flowId' having count(*)>1)
  then raise exception 'duplicate_collection_scope'; end if;
 for scope in select value from jsonb_array_elements(p_scopes) loop
  if jsonb_typeof(scope) is distinct from 'object' then raise exception 'invalid_collection_scope'; end if;
  if (select count(*) from jsonb_object_keys(scope))<>5
   or not (scope ?& array['versionId','flowId','domain','mode','profileFields'])
   or scope->>'mode' is null or scope->>'mode' not in ('existing','collection_only')
   or jsonb_typeof(scope->'profileFields') is distinct from 'array' then raise exception 'invalid_collection_scope'; end if;
  if exists(select 1 from jsonb_array_elements(scope->'profileFields') x where jsonb_typeof(x)<>'string'
    or x#>>'{}' not in ('name','phone','email','city','address'))
   or jsonb_array_length(scope->'profileFields')<>(select count(distinct value) from jsonb_array_elements(scope->'profileFields'))
   or (scope->>'mode'='existing' and scope->'profileFields'<>'[]'::jsonb) then raise exception 'invalid_collection_fields'; end if;
  select graph into g from public.visual_workflow_versions where business_id=p_business and id::text=scope->>'versionId';
  if not found or g->>'version'<>'2' then raise exception 'collection_version_unavailable'; end if;
  if exists(select 1 from public.conversation_states where business_id=p_business
    and strpos(collected::text,'"'||(scope->>'versionId')||'"')>0) then raise exception 'collection_version_in_use'; end if;
  select value into f from jsonb_array_elements(g->'flows') where value->>'id'=scope->>'flowId';
  if not found then raise exception 'collection_flow_unavailable'; end if;
  -- Scope is a specific existing published process, not a business-wide bypass.
  domain:=case when f->>'kind'='booking' or exists(select 1 from jsonb_array_elements(g->'nodes') n where n->>'kind'='booking' and f->'nodeIds' ? (n->>'id')) then 'booking'
   when jsonb_array_length(coalesce(f->'productIds','[]'::jsonb))>0 then 'order'
   when jsonb_array_length(coalesce(f->'serviceIds','[]'::jsonb))>0 then 'service' else null end;
  if domain is null or scope->>'domain' is distinct from domain then raise exception 'collection_domain_mismatch'; end if;
  -- Only explicit entity-bound order/service flows; general legacy collection is unchanged.
  if domain='booking' and jsonb_array_length(coalesce(f->'serviceIds','[]'::jsonb))=0 then raise exception 'collection_binding_required'; end if;
  if domain<>'order' and scope->'profileFields'<>'[]'::jsonb then raise exception 'domain_uses_workflow_requirements'; end if;
 end loop;
 -- Removing a used scope is also a change of authority, even if its new list is empty.
 if exists(select 1 from public.businesses b cross join lateral jsonb_array_elements(coalesce(b.agent_collection_policy->'scopes','[]'::jsonb)) s
   join public.conversation_states c on c.business_id=b.id and strpos(c.collected::text,'"'||(s->>'versionId')||'"')>0
   where b.id=p_business) then raise exception 'collection_version_in_use'; end if;
 next_revision:=old_revision+1;
 update public.businesses set agent_collection_policy=jsonb_build_object('version',1,'revision',next_revision,'scopes',p_scopes)
 where id=p_business;
 return next_revision;
end $$;
revoke all on function public.guard_agent_collection_policy(),public.save_agent_collection_policy(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_agent_collection_policy(uuid,uuid,integer,jsonb) to service_role;
commit;
