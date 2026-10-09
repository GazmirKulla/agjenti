-- Visual drafts and immutable execution versions. Safe to rerun in SQL Editor.
begin;
create table if not exists public.visual_workflow_versions (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 graph jsonb not null check (jsonb_typeof(graph)='object' and graph->>'version'='1' and octet_length(graph::text)<=100000),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), unique (business_id,id)
);
create table if not exists public.visual_workflows (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 draft jsonb not null check (jsonb_typeof(draft)='object' and draft->>'version'='1' and octet_length(draft::text)<=100000),
 revision integer not null default 1 check (revision>0),
 published_version_id uuid,
 enabled boolean not null default false,
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now(),
 foreign key (business_id,published_version_id) references public.visual_workflow_versions(business_id,id),
 check (not enabled or published_version_id is not null)
);
alter table public.visual_workflows enable row level security;
alter table public.visual_workflow_versions enable row level security;
drop policy if exists visual_read on public.visual_workflows;
create policy visual_read on public.visual_workflows for select to authenticated using (is_business_member(business_id) or is_platform_admin());
drop policy if exists visual_version_read on public.visual_workflow_versions;
create policy visual_version_read on public.visual_workflow_versions for select to authenticated using (is_business_member(business_id) or is_platform_admin());
revoke all on public.visual_workflows,public.visual_workflow_versions from public,anon,authenticated,service_role;
grant select on public.visual_workflows,public.visual_workflow_versions to authenticated,service_role;

create or replace function public.valid_visual_graph(p jsonb,p_publish boolean) returns boolean
language plpgsql immutable set search_path=public as $$
declare n jsonb; e jsonb; c jsonb; k text; port text; reached integer;
begin
 if jsonb_typeof(p) is distinct from 'object' or p->>'version' is distinct from '1'
  or jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 120
  or jsonb_typeof(p->'nodes') is distinct from 'array' or jsonb_typeof(p->'edges') is distinct from 'array' or octet_length(p::text)>100000 then return false; end if;
 if jsonb_array_length(p->'nodes') not between 1 and 32 or jsonb_array_length(p->'edges')>64 then return false; end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p->'nodes') x)<>jsonb_array_length(p->'nodes')
  or (select count(distinct x->>'id') from jsonb_array_elements(p->'edges') x)<>jsonb_array_length(p->'edges') then return false; end if;
 for n in select * from jsonb_array_elements(p->'nodes') loop
  k:=n->>'kind'; c:=n->'config';
  if coalesce(n->>'id','')!~'^[a-zA-Z0-9_-]{1,80}$' or n->>'id' in ('__proto__','prototype','constructor')
   or k is null or k not in ('start','condition','knowledge','collect','confirm','product','handoff','end')
   or jsonb_typeof(n->'label') is distinct from 'string' or length(n->>'label')>100
   or jsonb_typeof(c) is distinct from 'object'
   or jsonb_typeof(n->'position'->'x') is distinct from 'number' or jsonb_typeof(n->'position'->'y') is distinct from 'number' then return false; end if;
  if abs((n->'position'->>'x')::numeric)>5000 or abs((n->'position'->>'y')::numeric)>5000 then return false; end if;
  if (c?'prompt' and (jsonb_typeof(c->'prompt')<>'string' or length(c->>'prompt')>1500))
   or (c?'fieldKey' and (jsonb_typeof(c->'fieldKey')<>'string' or length(c->>'fieldKey')>60 or c->>'fieldKey' in ('__proto__','prototype','constructor')))
   or (c?'value' and (jsonb_typeof(c->'value')<>'string' or length(c->>'value')>300))
   or (c?'fieldType' and coalesce(c->>'fieldType','') not in ('text','email','phone','number','photo'))
   or (c?'condition' and coalesce(c->>'condition','') not in ('intent_order','intent_support','field_present','field_equals')) then return false; end if;
  if p_publish then
   if length(btrim(n->>'label'))=0 then return false; end if;
   if k in ('collect','confirm') and length(btrim(coalesce(c->>'prompt','')))=0 then return false; end if;
   if (k='collect' or (k='condition' and c->>'condition' in ('field_present','field_equals'))) and coalesce(c->>'fieldKey','')!~'^[a-zA-Z][a-zA-Z0-9_]{0,59}$' then return false; end if;
   if k='condition' and coalesce(c->>'condition','') not in ('intent_order','intent_support','field_present','field_equals') then return false; end if;
   if k='condition' and c->>'condition'='field_equals' and length(btrim(coalesce(c->>'value','')))=0 then return false; end if;
   if k='start' and exists(select 1 from jsonb_array_elements(p->'edges') x where x->>'target'=n->>'id') then return false; end if;
   foreach port in array case when k in ('condition','confirm') then array['yes','no'] when k in ('handoff','end') then array[]::text[] else array['next'] end loop
    if (select count(*) from jsonb_array_elements(p->'edges') x where x->>'source'=n->>'id' and x->>'port'=port)<>1 then return false; end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(p->'edges') x where x->>'source'=n->>'id' and
    case when k in ('condition','confirm') then x->>'port' not in ('yes','no') when k in ('end','handoff') then true else x->>'port'<>'next' end) then return false; end if;
  end if;
 end loop;
 for e in select * from jsonb_array_elements(p->'edges') loop
  if coalesce(e->>'id','')!~'^[a-zA-Z0-9_-]{1,80}$' or coalesce(e->>'port','') not in ('next','yes','no')
   or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'id'=e->>'source')
   or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'id'=e->>'target') then return false; end if;
 end loop;
 if p_publish then
  if (select count(*) from jsonb_array_elements(p->'nodes') x where x->>'kind'='start')<>1
   or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'kind' in ('end','handoff')) then return false; end if;
  with recursive reachable(id) as (
   select x->>'id' from jsonb_array_elements(p->'nodes') x where x->>'kind'='start'
   union select edge_item->>'target' from reachable r,jsonb_array_elements(p->'edges') edge_item where edge_item->>'source'=r.id
  ) select count(*) into reached from reachable;
  if reached<>jsonb_array_length(p->'nodes') then return false; end if;
  -- Transitive closure with UNION is bounded by 32*32 pairs, even for hostile graphs.
  if exists(with recursive instant(a,b) as (
   select edge_item->>'source',edge_item->>'target' from jsonb_array_elements(p->'edges') edge_item
    join jsonb_array_elements(p->'nodes') s on s->>'id'=edge_item->>'source'
    join jsonb_array_elements(p->'nodes') t on t->>'id'=edge_item->>'target'
    where s->>'kind' not in ('collect','confirm','product') and t->>'kind' not in ('collect','confirm','product')
   union select x.a,y.b from instant x join (select edge_item->>'source' a,edge_item->>'target' b from jsonb_array_elements(p->'edges') edge_item
    join jsonb_array_elements(p->'nodes') s on s->>'id'=edge_item->>'source'
    join jsonb_array_elements(p->'nodes') t on t->>'id'=edge_item->>'target'
    where s->>'kind' not in ('collect','confirm','product') and t->>'kind' not in ('collect','confirm','product')) y on x.b=y.a
  ) select 1 from instant where a=b) then return false; end if;
 end if;
 return true;
end $$;
revoke all on function public.valid_visual_graph(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.valid_visual_graph(jsonb,boolean) to service_role;

create or replace function public.save_visual_workflow(p_business uuid,p_user uuid,p_revision integer,p_graph jsonb,p_operation text)
returns integer language plpgsql security definer set search_path=public as $$
declare current public.visual_workflows; version_id uuid;
begin
 perform 1 from businesses where id=p_business for update;
 if not found or not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 if p_operation is null or p_operation not in ('draft','publish','enable','disable') then raise exception 'invalid_operation'; end if;
 select * into current from visual_workflows where business_id=p_business;
 if p_revision is null or coalesce(current.revision,0)<>p_revision then raise exception 'stale_workflow'; end if;
 if p_operation in ('draft','publish') then
  if not public.valid_visual_graph(p_graph,p_operation='publish') then raise exception 'invalid_graph'; end if;
  if p_operation='publish' then
   insert into visual_workflow_versions(business_id,graph,created_by) values(p_business,p_graph,p_user) returning id into version_id;
  end if;
  insert into visual_workflows(business_id,draft,revision,published_version_id,enabled,updated_by)
   values(p_business,p_graph,p_revision+1,version_id,p_operation='publish',p_user)
  on conflict(business_id) do update set draft=p_graph,revision=p_revision+1,
   published_version_id=coalesce(version_id,visual_workflows.published_version_id),
   enabled=case when p_operation='publish' then true else visual_workflows.enabled end,
   updated_by=p_user,updated_at=now();
 else
  if current.business_id is null or (p_operation='enable' and current.published_version_id is null) then raise exception 'no_published_workflow'; end if;
  update visual_workflows set enabled=p_operation='enable',revision=p_revision+1,updated_by=p_user,updated_at=now() where business_id=p_business;
 end if;
 return p_revision+1;
end $$;
revoke all on function public.save_visual_workflow(uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_visual_workflow(uuid,uuid,integer,jsonb,text) to service_role;

do $$ begin
 if to_regprocedure('public.pre_visual_business_setup_status(uuid)') is null then
  alter function public.business_setup_status(uuid) rename to pre_visual_business_setup_status;
 end if;
end $$;
create or replace function public.business_setup_status(p_business_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare base jsonb; published uuid; signature text;
begin
 base:=pre_visual_business_setup_status(p_business_id);
 select published_version_id into published from visual_workflows where business_id=p_business_id and enabled;
 signature:=case when published is null then base->>'signature' else md5((base->>'signature')||published::text) end;
 return base||jsonb_build_object('signature',signature,'tested',coalesce((select tested_signature=signature from business_setup where business_id=p_business_id),false));
end $$;
revoke all on function public.business_setup_status(uuid),public.pre_visual_business_setup_status(uuid) from public,anon,authenticated;
grant execute on function public.business_setup_status(uuid),public.pre_visual_business_setup_status(uuid) to service_role;
commit;
