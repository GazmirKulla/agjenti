begin;
-- Profiles exist independently of CRM promotion; identity never depends on phone/name.
create table public.conversation_profiles (
 business_id uuid not null references public.businesses(id) on delete cascade,
 participant_id text not null,
 connection_id uuid not null references public.instagram_connections(id) on delete cascade,
 profile jsonb not null default '{}' check(jsonb_typeof(profile)='object' and octet_length(profile::text)<20000),
 updated_at timestamptz not null default now(),
 primary key(business_id,participant_id)
);
alter table public.conversation_profiles enable row level security;
revoke all on public.conversation_profiles from public,anon,authenticated;
grant select,insert,update,delete on public.conversation_profiles to service_role;
alter table public.conversation_states add column revision integer not null default 0;

create table public.linear_workflow_versions (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 workflow_id uuid not null references public.workflows(id) on delete cascade,
 name text not null,
 steps jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(business_id,id)
);
create index on public.linear_workflow_versions(workflow_id,created_at desc);
alter table public.linear_workflow_versions enable row level security;
revoke all on public.linear_workflow_versions from public,anon,authenticated,service_role;
grant select on public.linear_workflow_versions to service_role;

-- Snapshot legacy edits as well: external import/template writers cannot alter an active run.
create function public.snapshot_linear_workflow() returns trigger language plpgsql security definer set search_path=public as $$
declare wid uuid; w public.workflows; definition jsonb;
begin
 if tg_table_name='workflow_steps' then wid:=coalesce(new.workflow_id,old.workflow_id); else wid:=coalesce(new.id,old.id); end if;
 select * into w from workflows where id=wid for update;
 if not found then return null; end if;
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key',key,'kind',kind,'required',required,'label',config->>'label','prompt',config->>'prompt','fieldKey',config->>'fieldKey','fieldType',config->>'fieldType','options',config->'options')) order by position),'[]') into definition from workflow_steps where workflow_id=wid;
 if not exists(select 1 from linear_workflow_versions where workflow_id=wid and name=w.name and steps=definition and id=(select id from linear_workflow_versions where workflow_id=wid order by created_at desc limit 1)) then
  insert into linear_workflow_versions(business_id,workflow_id,name,steps) values(w.business_id,wid,w.name,definition);
 end if;
 return null;
end $$;
create constraint trigger snapshot_linear_steps after insert or update or delete on public.workflow_steps deferrable initially deferred for each row execute function public.snapshot_linear_workflow();
create constraint trigger snapshot_linear_name after insert or update on public.workflows deferrable initially deferred for each row execute function public.snapshot_linear_workflow();
insert into public.linear_workflow_versions(business_id,workflow_id,name,steps)
select w.business_id,w.id,w.name,coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key',s.key,'kind',s.kind,'required',s.required,'label',s.config->>'label','prompt',s.config->>'prompt','fieldKey',s.config->>'fieldKey','fieldType',s.config->>'fieldType','options',s.config->'options')) order by s.position) from workflow_steps s where s.workflow_id=w.id),'[]') from public.workflows w;
-- Pin existing orders before any future definition edits; no profile inference/backfill.
update public.conversation_states cs set collected=jsonb_set(cs.collected,'{linearSnapshot}',jsonb_build_object('id',v.workflow_id,'versionId',v.id,'name',v.name,'steps',v.steps))
from public.linear_workflow_versions v where cs.workflow_id=v.workflow_id and cs.business_id=v.business_id and cs.collected->>'product_id' is not null and cs.status='in_progress' and not(cs.collected?'context') and not(cs.collected?'orderWorkflowSnapshot');

create table public.product_workflow_drafts (
 product_id uuid primary key references public.products(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,
 revision integer not null default 0,
 published_revision integer,
 definition jsonb not null,
 scope text not null check(scope in ('product','shared','link')),
 source_workflow_id uuid references public.workflows(id) on delete cascade,
 base_workflow_id uuid references public.workflows(id) on delete set null,
 base_version_id uuid,
 updated_at timestamptz not null default now()
);
alter table public.product_workflow_drafts enable row level security;
revoke all on public.product_workflow_drafts from public,anon,authenticated,service_role;
grant select on public.product_workflow_drafts to service_role;

create function public.valid_linear_definition(d jsonb) returns boolean language plpgsql immutable set search_path=public as $$
declare s jsonb;
begin
 if jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'name') is distinct from 'string' or length(btrim(d->>'name')) not between 1 and 120 or jsonb_typeof(d->'steps') is distinct from 'array' or octet_length(d::text)>50000 then return false;end if;
 if jsonb_array_length(d->'steps') not between 1 and 32 or (select count(distinct x->>'key') from jsonb_array_elements(d->'steps') x)<>jsonb_array_length(d->'steps') then return false;end if;
 if not exists(select 1 from jsonb_array_elements(d->'steps') x where x->>'kind'='customer') then return false;end if;
 for s in select * from jsonb_array_elements(d->'steps') loop
  if coalesce(s->>'key','')!~'^[a-zA-Z][a-zA-Z0-9_]{0,59}$' or s->>'key' in ('constructor','prototype','choose_product','order_ready','order_confirm') or coalesce(s->>'kind','') not in ('text','choice','photo','confirm','customer') then return false;end if;
  if (s?'label' and (jsonb_typeof(s->'label')<>'string' or length(s->>'label')>100)) or (s?'prompt' and (jsonb_typeof(s->'prompt')<>'string' or length(s->>'prompt')>1500)) or (s?'required' and jsonb_typeof(s->'required')<>'boolean') then return false;end if;
  if s?'fieldKey' and (coalesce(s->>'fieldKey','')!~'^[a-zA-Z][a-zA-Z0-9_]{0,59}$' or s->>'fieldKey' in ('constructor','prototype')) then return false;end if;
  if s?'fieldType' and coalesce(s->>'fieldType','') not in ('text','phone','email','number','photo') then return false;end if;
  if s->>'fieldType'='photo' and s->>'kind'<>'photo' then return false;end if;
  if s->>'kind'='photo' and s->>'fieldKey' in ('customer_name','customer_phone','customer_email','customer_city','customer_address') then return false;end if;
  if s?'options' then
   if jsonb_typeof(s->'options')<>'array' or jsonb_array_length(s->'options') not between 1 and 30 then return false;end if;
   if exists(select 1 from jsonb_array_elements(s->'options') o where jsonb_typeof(o)<>'string' or length(btrim(o#>>'{}')) not between 1 and 100) then return false;end if;
  end if;
 end loop;
 return true;
end $$;
revoke all on function public.valid_linear_definition(jsonb) from public,anon,authenticated;
grant execute on function public.valid_linear_definition(jsonb) to service_role;

create function public.save_product_workflow(p_business uuid,p_user uuid,p_product uuid,p_revision integer,p_definition jsonb,p_scope text,p_operation text,p_source uuid default null,p_expected jsonb default null)
returns integer language plpgsql security definer set search_path=public as $$
declare product public.products; draft public.product_workflow_drafts; wid uuid; latest uuid; active_version uuid; affected jsonb; s jsonb; pos integer:=0;
begin
 perform 1 from businesses where id=p_business for update;
 if not found or not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 select * into product from products where id=p_product and business_id=p_business for update;
 if not found then raise exception 'invalid_product'; end if;
 select * into draft from product_workflow_drafts where product_id=p_product;
 if p_revision is null or coalesce(draft.revision,0)<>p_revision then raise exception 'stale_workflow'; end if;
 select id into active_version from linear_workflow_versions where workflow_id=product.workflow_id and business_id=p_business order by created_at desc limit 1;
 if p_expected is null or product.workflow_id::text is distinct from p_expected->>'workflowId' or active_version::text is distinct from p_expected->>'versionId' then raise exception 'stale_workflow'; end if;
 if (case when p_operation='publish' then draft.scope else p_scope end)='shared' then
  select coalesce(jsonb_agg(id::text order by id::text),'[]') into affected from products where business_id=p_business and workflow_id=product.workflow_id;
  if affected is distinct from p_expected->'affected' then raise exception 'stale_workflow'; end if;
 end if;
 if p_operation='draft' then
  if p_scope not in ('product','shared','link') or p_scope is null then raise exception 'invalid_scope'; end if;
  wid:=case when p_scope='link' then p_source else product.workflow_id end;
  if wid is not null and not exists(select 1 from workflows where id=wid and business_id=p_business) then raise exception 'invalid_workflow'; end if;
  select id into latest from linear_workflow_versions where workflow_id=wid and business_id=p_business order by created_at desc limit 1;
  if latest::text is distinct from p_expected->>'sourceVersionId' then raise exception 'stale_workflow'; end if;
  if p_scope='link' then
   select jsonb_build_object('name',name,'steps',steps) into p_definition from linear_workflow_versions where id=latest;
  end if;
  if p_definition is null or jsonb_typeof(p_definition->'steps') is distinct from 'array' or jsonb_array_length(p_definition->'steps') not between 1 and 32 or length(btrim(p_definition->>'name')) not between 1 and 120 or octet_length(p_definition::text)>50000 then raise exception 'invalid_definition'; end if;
  if not valid_linear_definition(p_definition) then raise exception 'invalid_definition'; end if;
  insert into product_workflow_drafts(product_id,business_id,revision,definition,scope,source_workflow_id,base_workflow_id,base_version_id)
  values(p_product,p_business,p_revision+1,p_definition,p_scope,wid,product.workflow_id,latest)
  on conflict(product_id) do update set revision=p_revision+1,definition=p_definition,scope=p_scope,source_workflow_id=wid,base_workflow_id=product.workflow_id,base_version_id=latest,updated_at=now();
 elsif p_operation='publish' then
  if draft.published_revision=draft.revision then raise exception 'already_published'; end if;
  if draft.product_id is null or product.workflow_id is distinct from draft.base_workflow_id then raise exception 'stale_workflow'; end if;
  wid:=draft.source_workflow_id;
  perform 1 from workflows where id=wid for update;
  select id into latest from linear_workflow_versions where workflow_id=wid and business_id=p_business order by created_at desc limit 1;
  if latest is distinct from draft.base_version_id then raise exception 'stale_workflow'; end if;
  if draft.scope<>'link' then
   if wid is null or (draft.scope='product' and exists(select 1 from products where workflow_id=wid and id<>p_product)) then
    insert into workflows(business_id,name) values(p_business,draft.definition->>'name') returning id into wid;
   else update workflows set name=draft.definition->>'name' where id=wid and business_id=p_business;
   end if;
   delete from workflow_steps where workflow_id=wid;
   for s in select * from jsonb_array_elements(draft.definition->'steps') loop
    if coalesce(s->>'key','')!~'^[a-zA-Z][a-zA-Z0-9_]{0,59}$' or s->>'key' in ('constructor','prototype','choose_product','order_ready','order_confirm') or coalesce(s->>'kind','') not in ('choice','text','photo','customer','confirm') then raise exception 'invalid_step'; end if;
    insert into workflow_steps(workflow_id,key,position,kind,required,config) values(wid,s->>'key',pos,s->>'kind',coalesce((s->>'required')::boolean,true),s-'key'-'kind'-'required');
    pos:=pos+1;
   end loop;
  end if;
  if wid is null then raise exception 'invalid_workflow'; end if;
  update products set workflow_id=wid,updated_at=now() where id=p_product and business_id=p_business;
  update product_workflow_drafts set revision=p_revision+1,published_revision=p_revision+1,base_workflow_id=wid,source_workflow_id=wid,updated_at=now() where product_id=p_product;
 else raise exception 'invalid_operation'; end if;
 return p_revision+1;
end $$;
revoke all on function public.save_product_workflow(uuid,uuid,uuid,integer,jsonb,text,text,uuid,jsonb),public.snapshot_linear_workflow() from public,anon,authenticated;
grant execute on function public.save_product_workflow(uuid,uuid,uuid,integer,jsonb,text,text,uuid,jsonb) to service_role;
commit;
