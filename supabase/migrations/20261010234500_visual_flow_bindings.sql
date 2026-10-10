-- Product/service assignments belong to immutable visual-flow definitions.
-- Shape validation stays immutable; tenant ownership is checked by the atomic writer.
begin;

create or replace function public.valid_visual_graph(p jsonb,p_publish boolean) returns boolean
language plpgsql immutable set search_path=public as $$
declare n jsonb; e jsonb; c jsonb; f jsonb; member text; members text[]:=array[]::text[]; flow_ids text[]:=array[]::text[]; k text; port text; reached integer; binding_key text; binding jsonb; binding_id uuid; product_ids uuid[]:=array[]::uuid[]; service_ids uuid[]:=array[]::uuid[];
begin
 if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'version') is distinct from 'number' or coalesce(p->>'version','') not in ('1','2')
  or jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 120
  or jsonb_typeof(p->'nodes') is distinct from 'array' or jsonb_typeof(p->'edges') is distinct from 'array' or octet_length(p::text)>100000 then return false; end if;
 if jsonb_array_length(p->'nodes') not between 1 and 32 or jsonb_array_length(p->'edges')>64 then return false; end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p->'nodes') x)<>jsonb_array_length(p->'nodes')
  or (select count(distinct x->>'id') from jsonb_array_elements(p->'edges') x)<>jsonb_array_length(p->'edges') then return false; end if;
 for n in select * from jsonb_array_elements(p->'nodes') loop
  k:=n->>'kind'; c:=n->'config';
  if jsonb_typeof(n->'id') is distinct from 'string' or coalesce(n->>'id','')!~'^[a-zA-Z0-9_-]{1,80}$' or n->>'id' in ('__proto__','prototype','constructor')
   or k is null or k not in ('start','condition','knowledge','collect','confirm','product','booking','order_status','handoff','end')
   or jsonb_typeof(n->'label') is distinct from 'string' or length(n->>'label')>100
   or jsonb_typeof(c) is distinct from 'object'
   or jsonb_typeof(n->'position'->'x') is distinct from 'number' or jsonb_typeof(n->'position'->'y') is distinct from 'number' then return false; end if;
  if k in ('booking','order_status') and p->>'version'<>'2' then return false; end if;
  if abs((n->'position'->>'x')::numeric)>5000 or abs((n->'position'->>'y')::numeric)>5000 then return false; end if;
  if (c?'prompt' and (jsonb_typeof(c->'prompt')<>'string' or length(c->>'prompt')>1500))
   or (c?'fieldKey' and (jsonb_typeof(c->'fieldKey')<>'string' or length(c->>'fieldKey')>60 or c->>'fieldKey' in ('__proto__','prototype','constructor')))
   or (c?'value' and (jsonb_typeof(c->'value')<>'string' or length(c->>'value')>300))
   or (c?'fieldType' and coalesce(c->>'fieldType','') not in ('text','email','phone','number','photo'))
   or (c?'condition' and coalesce(c->>'condition','') not in ('intent_order','intent_support','intent_booking','field_present','field_equals')) then return false; end if;
  if c->>'condition'='intent_booking' and p->>'version'<>'2' then return false; end if;
  if p_publish then
   if length(btrim(n->>'label'))=0 then return false; end if;
   if k in ('collect','confirm') and length(btrim(coalesce(c->>'prompt','')))=0 then return false; end if;
   if (k='collect' or (k='condition' and c->>'condition' in ('field_present','field_equals'))) and coalesce(c->>'fieldKey','')!~'^[a-zA-Z][a-zA-Z0-9_]{0,59}$' then return false; end if;
   if k='condition' and coalesce(c->>'condition','') not in ('intent_order','intent_support','intent_booking','field_present','field_equals') then return false; end if;
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
  if jsonb_typeof(e->'id') is distinct from 'string' or coalesce(e->>'id','')!~'^[a-zA-Z0-9_-]{1,80}$' or coalesce(e->>'port','') not in ('next','yes','no')
   or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'id'=e->>'source')
   or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'id'=e->>'target') then return false; end if;
 end loop;
 if p->>'version'='2' then
  if jsonb_typeof(p->'flows') is distinct from 'array' or jsonb_array_length(p->'flows')>16 then return false; end if;
  if p_publish and jsonb_array_length(p->'flows')=0 then return false; end if;
  for f in select * from jsonb_array_elements(p->'flows') loop
   if jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(f->'id') is distinct from 'string' or coalesce(f->>'id','')!~'^[a-zA-Z0-9_-]{1,80}$'
    or f->>'id' in ('__proto__','prototype','constructor') or f->>'id'=any(flow_ids)
    or jsonb_typeof(f->'label') is distinct from 'string' or length(f->>'label')>100
    or coalesce(f->>'kind','') not in ('order','booking','information','support','custom')
    or jsonb_typeof(f->'nodeIds') is distinct from 'array' or jsonb_array_length(f->'nodeIds') not between 1 and 32
    or jsonb_typeof(f->'entryNodeId') is distinct from 'string'
    or not exists(select 1 from jsonb_array_elements(f->'nodeIds') x where x=to_jsonb(f->>'entryNodeId'))
    or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'id'=f->>'entryNodeId' and x->>'kind' not in ('start','end')) then return false; end if;
   if p_publish and length(btrim(f->>'label'))=0 then return false; end if;
   flow_ids:=array_append(flow_ids,f->>'id');
   foreach binding_key in array array['productIds','serviceIds'] loop
    if f?binding_key then
     if jsonb_typeof(f->binding_key) is distinct from 'array' or jsonb_array_length(f->binding_key)>200 then return false; end if;
     for binding in select * from jsonb_array_elements(f->binding_key) loop
      if jsonb_typeof(binding) is distinct from 'string' or (binding#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
      binding_id:=(binding#>>'{}')::uuid;
      if binding_key='productIds' then
       if binding_id=any(product_ids) then return false; end if;
       product_ids:=array_append(product_ids,binding_id);
      else
       if binding_id=any(service_ids) then return false; end if;
       service_ids:=array_append(service_ids,binding_id);
      end if;
     end loop;
    end if;
   end loop;
   for c in select * from jsonb_array_elements(f->'nodeIds') loop
    if jsonb_typeof(c) is distinct from 'string' then return false; end if;
    member:=c#>>'{}';
    if member=any(members) or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'id'=member) then return false; end if;
    members:=array_append(members,member);
   end loop;
  end loop;
 end if;
 if p_publish then
  if (select count(*) from jsonb_array_elements(p->'nodes') x where x->>'kind'='start')<>1
   or not exists(select 1 from jsonb_array_elements(p->'nodes') x where x->>'kind' in ('end','handoff')) then return false; end if;
  with recursive reachable(id) as (
   select x->>'id' from jsonb_array_elements(p->'nodes') x where x->>'kind'='start' or (p->>'version'='2' and exists(select 1 from jsonb_array_elements(p->'flows') flow_entry where flow_entry->>'entryNodeId'=x->>'id'))
   union select edge_item->>'target' from reachable r,jsonb_array_elements(p->'edges') edge_item where edge_item->>'source'=r.id
  ) select count(*) into reached from reachable;
  if reached<>jsonb_array_length(p->'nodes') then return false; end if;
  -- Transitive closure with UNION is bounded by 32*32 pairs, even for hostile graphs.
  if exists(with recursive instant(a,b) as (
   select edge_item->>'source',edge_item->>'target' from jsonb_array_elements(p->'edges') edge_item
    join jsonb_array_elements(p->'nodes') s on s->>'id'=edge_item->>'source'
    join jsonb_array_elements(p->'nodes') t on t->>'id'=edge_item->>'target'
    where s->>'kind' not in ('collect','confirm','product','booking') and t->>'kind' not in ('collect','confirm','product','booking')
   union select x.a,y.b from instant x join (select edge_item->>'source' a,edge_item->>'target' b from jsonb_array_elements(p->'edges') edge_item
    join jsonb_array_elements(p->'nodes') s on s->>'id'=edge_item->>'source'
    join jsonb_array_elements(p->'nodes') t on t->>'id'=edge_item->>'target'
    where s->>'kind' not in ('collect','confirm','product','booking') and t->>'kind' not in ('collect','confirm','product','booking')) y on x.b=y.a
  ) select 1 from instant where a=b) then return false; end if;
 end if;
 return true;
end $$;
revoke all on function public.valid_visual_graph(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.valid_visual_graph(jsonb,boolean) to service_role;

create or replace function public.save_visual_workflow(p_business uuid,p_user uuid,p_revision integer,p_graph jsonb,p_operation text)
returns integer language plpgsql security definer set search_path=public as $$
declare current public.visual_workflows; version_id uuid; product_ids uuid[]; service_ids uuid[];
begin
 perform 1 from businesses where id=p_business for update;
 if not found or not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 if p_operation is null or p_operation not in ('draft','publish','enable','disable') then raise exception 'invalid_operation'; end if;
 select * into current from visual_workflows where business_id=p_business;
 if p_revision is null or coalesce(current.revision,0)<>p_revision then raise exception 'stale_workflow'; end if;
 if p_operation in ('draft','publish') then
  if not public.valid_visual_graph(p_graph,p_operation='publish') then raise exception 'invalid_graph'; end if;
  if p_graph->>'version'='2' then
   select coalesce(array_agg((requested.value#>>'{}')::uuid),array[]::uuid[]) into product_ids
    from jsonb_array_elements(p_graph->'flows') flow
    cross join lateral jsonb_array_elements(coalesce(flow->'productIds','[]'::jsonb)) requested(value);
   select coalesce(array_agg((requested.value#>>'{}')::uuid),array[]::uuid[]) into service_ids
    from jsonb_array_elements(p_graph->'flows') flow
    cross join lateral jsonb_array_elements(coalesce(flow->'serviceIds','[]'::jsonb)) requested(value);
   -- Lock catalog rows while checking ownership, preventing deletion or tenant
   -- reassignment between validation and the atomic draft/publication write.
   perform id from products where business_id=p_business and id=any(product_ids) order by id for share;
   perform id from booking_services where business_id=p_business and id=any(service_ids) order by id for share;
   if (select count(*) from products where business_id=p_business and id=any(product_ids))<>cardinality(product_ids)
    or (select count(*) from booking_services where business_id=p_business and id=any(service_ids))<>cardinality(service_ids)
    then raise exception 'invalid_workflow_targets'; end if;
  end if;
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

commit;
