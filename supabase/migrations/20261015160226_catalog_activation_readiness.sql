begin;
-- Package A: catalog activity grants discovery only. Keep the existing atomic
-- product + DRAFT binding RPC, actor/revision guards and service-only ACL.
-- No publication, version changes, data backfill or order transaction changes.
create or replace function public.save_products_with_visual_flow(p_business uuid,p_user uuid,p_revision integer,p_flow text,p_mode text,p_products jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare w public.visual_workflows; old_product public.products; saved public.products; item jsonb; ids uuid[]:=array[]::uuid[]; graph jsonb; flows jsonb; f jsonb; refs jsonb; n integer:=0;
begin
 perform 1 from public.businesses where id=p_business for update;
 if not found or not(exists(select 1 from public.business_users where business_id=p_business and user_id=p_user) or exists(select 1 from public.platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 if p_mode is null or p_mode not in ('create','update','import','bind') or jsonb_typeof(p_products) is distinct from 'array' or jsonb_array_length(p_products) not between 1 and 100 then raise exception 'invalid_products'; end if;
 if not public.business_module_allowed(p_business,'products') or not public.business_module_allowed(p_business,'workflows') then raise exception 'module_disabled'; end if;
 -- Preserve the previous RPC's action policy: membership/module access alone
 -- does not authorize creation/import. Existing update/bind semantics stay intact.
 if p_mode in ('create','import') and not public.can_execute_business_action(p_business,p_user,'product.create',false) then raise exception 'action_denied'; end if;
 select * into w from public.visual_workflows where business_id=p_business;
 if p_revision is null or w.business_id is null or w.revision<>p_revision then raise exception 'stale_workflow'; end if;
 graph:=w.draft;
 if graph->>'version'<>'2' or not exists(select 1 from jsonb_array_elements(graph->'flows') flow where flow->>'id'=p_flow) then raise exception 'missing_visual_flow'; end if;
 for item in select value from jsonb_array_elements(p_products) loop
  old_product:=null;
  if p_mode in ('bind','update') then
   select * into old_product from public.products where id=(item->>'id')::uuid and business_id=p_business for update;
   if old_product.id is null then raise exception 'foreign_product'; end if;
   if item->>'expected_updated_at' is not null and old_product.updated_at<>(item->>'expected_updated_at')::timestamptz then raise exception 'stale_product'; end if;
  elsif p_mode='import' and nullif(item->>'external_id','') is not null then
   select * into old_product from public.products where business_id=p_business and external_id=item->>'external_id' for update;
  end if;
  if p_mode='bind' then
   update public.products set product_type_id=case when item ? 'product_type_id' then (item->>'product_type_id')::uuid else product_type_id end,updated_at=clock_timestamp()
    where id=old_product.id and business_id=p_business returning * into saved;
  elsif old_product.id is not null then
   update public.products set name=item->>'name',description=item->>'description',image_url=item->>'image_url',
    price_amount=(item->>'price_amount')::numeric,currency=item->>'currency',
    sku=case when p_mode='import' then coalesce(nullif(item->>'sku',''),sku) else item->>'sku' end,
    product_type_id=case when item ? 'product_type_id' then (item->>'product_type_id')::uuid else product_type_id end,
    is_active=case when p_mode='update' then coalesce((item->>'is_active')::boolean,false) else is_active end,
    updated_at=clock_timestamp() where id=old_product.id and business_id=p_business returning * into saved;
  else
   insert into public.products(business_id,name,description,image_url,price_amount,currency,sku,external_id,product_type_id,is_active,source)
   values(p_business,item->>'name',item->>'description',item->>'image_url',(item->>'price_amount')::numeric,item->>'currency',nullif(item->>'sku',''),nullif(item->>'external_id',''),(item->>'product_type_id')::uuid,
    case when p_mode='create' then coalesce((item->>'is_active')::boolean,false) else false end,'manual') returning * into saved;
  end if;
  if saved.product_type_id is not null and not exists(select 1 from public.product_types where id=saved.product_type_id and is_active) then raise exception 'invalid_product_type'; end if;
  if saved.is_active and (saved.price_amount is null or saved.price_amount<0 or saved.price_amount::text in ('NaN','Infinity','-Infinity') or saved.currency is null or saved.currency!~'^[A-Z]{3}$' or saved.product_type_id is null)
    then raise exception 'catalog_configuration_required'; end if;
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
 perform public.save_visual_workflow(p_business,p_user,p_revision,graph,'draft');
 return n;
end $$;
revoke all on function public.save_products_with_visual_flow(uuid,uuid,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_products_with_visual_flow(uuid,uuid,integer,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
