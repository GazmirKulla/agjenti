begin;
-- Add visual scopes without replacing existing linear workflow identities.
alter table public.agent_training_memories
 add column visual_flow_id text check (visual_flow_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
 add column visual_node_id text check (visual_node_id ~ '^[a-zA-Z0-9_-]{1,100}$');
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.agent_training_memories'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%kind%' and pg_get_constraintdef(oid) like '%workflow_id%'
 loop execute format('alter table public.agent_training_memories drop constraint %I',c.conname); end loop;
end $$;
alter table public.agent_training_memories
 add constraint training_scope_exclusive check (visual_flow_id is null or (workflow_id is null and step_key is null)),
 add constraint training_visual_node_scope check (visual_node_id is null or visual_flow_id is not null),
 add constraint training_style_scope check (kind<>'style' or (workflow_id is null and step_key is null and visual_flow_id is null and visual_node_id is null)),
 add constraint training_workflow_scope check (kind<>'workflow' or workflow_id is not null or visual_flow_id is not null);
create function public.validate_visual_training_scope() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.visual_flow_id is null then return new; end if;
 -- Orphaned lessons may be disabled/deleted; never broaden them into global rules.
 if tg_op='UPDATE' and not new.is_active then return new; end if;
 if not exists (
  select 1 from (
   select draft as graph from visual_workflows where business_id=new.business_id
   union all
   select v.graph from visual_workflow_versions v join visual_workflows w on w.published_version_id=v.id and w.business_id=v.business_id where w.business_id=new.business_id
  ) graphs cross join lateral jsonb_array_elements(coalesce(graph->'flows','[]'::jsonb)) f
  where f->>'id'=new.visual_flow_id and (new.visual_node_id is null or ((f->'nodeIds') ? new.visual_node_id and exists(select 1 from jsonb_array_elements(graph->'nodes') n where n->>'id'=new.visual_node_id)))
 ) then raise exception 'training_visual_scope_missing'; end if;
 return new;
end $$;
revoke all on function public.validate_visual_training_scope() from public,anon,authenticated;
create trigger validate_visual_training_scope before insert or update on public.agent_training_memories for each row execute function public.validate_visual_training_scope();

-- Product persistence + draft assignment is one transaction. Never publish implicitly.
create function public.save_products_with_visual_flow(p_business uuid,p_user uuid,p_revision integer,p_flow text,p_mode text,p_products jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare w visual_workflows; old_product products; saved products; item jsonb; ids uuid[]:=array[]::uuid[]; target uuid; graph jsonb; flows jsonb; f jsonb; refs jsonb; n integer:=0;
begin
 perform 1 from businesses where id=p_business for update;
 if not found or not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 if p_mode is null or p_mode not in ('create','update','import','bind') or jsonb_typeof(p_products) is distinct from 'array' or jsonb_array_length(p_products) not between 1 and 100 then raise exception 'invalid_products'; end if;
 select * into w from visual_workflows where business_id=p_business;
 if p_revision is null or w.business_id is null or w.revision<>p_revision then raise exception 'stale_workflow'; end if;
 graph:=w.draft;
 if graph->>'version'<>'2' or not exists(select 1 from jsonb_array_elements(graph->'flows') flow where flow->>'id'=p_flow) then raise exception 'missing_visual_flow'; end if;
 for item in select value from jsonb_array_elements(p_products) loop
  old_product:=null; target:=null;
  if p_mode in ('bind','update') then
   select * into old_product from products where id=(item->>'id')::uuid and business_id=p_business for update;
   if old_product.id is null then raise exception 'foreign_product'; end if;
   if item->>'expected_updated_at' is not null and old_product.updated_at<>(item->>'expected_updated_at')::timestamptz then raise exception 'stale_product'; end if;
  elsif p_mode='import' and nullif(item->>'external_id','') is not null then
   select * into old_product from products where business_id=p_business and external_id=item->>'external_id' for update;
  end if;
  if p_mode='bind' then
   update products set product_type_id=case when item ? 'product_type_id' then (item->>'product_type_id')::uuid else product_type_id end,updated_at=clock_timestamp()
    where id=old_product.id and business_id=p_business returning * into saved;
  elsif old_product.id is not null then
   update products set name=item->>'name',description=item->>'description',image_url=item->>'image_url',
    price_amount=(item->>'price_amount')::numeric,currency=item->>'currency',
    sku=case when p_mode='import' then coalesce(nullif(item->>'sku',''),sku) else item->>'sku' end,
    product_type_id=case when item ? 'product_type_id' then (item->>'product_type_id')::uuid else product_type_id end,
    is_active=case when p_mode='update' then coalesce((item->>'is_active')::boolean,false) else is_active end,
    updated_at=clock_timestamp() where id=old_product.id and business_id=p_business returning * into saved;
  else
   insert into products(business_id,name,description,image_url,price_amount,currency,sku,external_id,product_type_id,is_active,source)
   values(p_business,item->>'name',item->>'description',item->>'image_url',(item->>'price_amount')::numeric,item->>'currency',nullif(item->>'sku',''),nullif(item->>'external_id',''),(item->>'product_type_id')::uuid,
    case when p_mode='create' then coalesce((item->>'is_active')::boolean,false) else false end,'manual') returning * into saved;
  end if;
  if saved.product_type_id is not null and not exists(select 1 from product_types where id=saved.product_type_id and is_active) then raise exception 'invalid_product_type'; end if;
  if saved.is_active and (saved.price_amount is null or saved.price_amount<0 or saved.product_type_id is null or (saved.workflow_id is null and not exists(
    select 1 from visual_workflow_versions v cross join lateral jsonb_array_elements(v.graph->'flows') flow
    where v.id=w.published_version_id and v.business_id=p_business and w.enabled and (flow->'productIds') ? saved.id::text
   ))) then raise exception 'activation_requires_published'; end if;
  if saved.id=any(ids) then raise exception 'duplicate_product'; end if;
  ids:=array_append(ids,saved.id); n:=n+1;
 end loop;
 flows:='[]'::jsonb;
 for f in select value from jsonb_array_elements(graph->'flows') loop
  select coalesce(jsonb_agg(value),'[]'::jsonb) into refs from jsonb_array_elements(coalesce(f->'productIds','[]'::jsonb)) where not ((value#>>'{}')::uuid=any(ids));
  if f->>'id'=p_flow then refs:=refs||to_jsonb(ids); end if;
  flows:=flows||jsonb_build_array(jsonb_set(f,'{productIds}',refs));
 end loop;
 graph:=jsonb_set(graph,'{flows}',flows);
 perform save_visual_workflow(p_business,p_user,p_revision,graph,'draft');
 return n;
end $$;
revoke all on function public.save_products_with_visual_flow(uuid,uuid,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_products_with_visual_flow(uuid,uuid,integer,text,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
