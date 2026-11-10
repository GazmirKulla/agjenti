-- Item kinds: every listing is a product; its kind (product, property,
-- vehicle, equipment…) adds its own fields (attributes) and availability. The
-- business chooses its main kind and may rename its items in the menu.
begin;

alter table public.products add column if not exists item_kind text not null default 'product';
alter table public.products drop constraint if exists products_item_kind_format;
alter table public.products add constraint products_item_kind_format check (item_kind ~ '^[a-z_]{2,30}$');
alter table public.products add column if not exists attributes jsonb not null default '{}'::jsonb;
alter table public.products drop constraint if exists products_attributes_object;
alter table public.products add constraint products_attributes_object check (jsonb_typeof(attributes)='object' and octet_length(attributes::text) <= 8192);
alter table public.products add column if not exists availability text not null default 'available';
alter table public.products drop constraint if exists products_availability_check;
alter table public.products add constraint products_availability_check check (availability in ('available','reserved','sold','rented'));
create index if not exists products_business_availability on public.products(business_id, availability);

alter table public.businesses add column if not exists item_kind text;
alter table public.businesses drop constraint if exists businesses_item_kind_format;
alter table public.businesses add constraint businesses_item_kind_format check (item_kind is null or item_kind ~ '^[a-z_]{2,30}$');
alter table public.businesses add column if not exists item_plural text check (item_plural is null or char_length(item_plural) between 2 and 30);
alter table public.businesses add column if not exists item_singular text check (item_singular is null or char_length(item_singular) between 2 and 30);

-- The visual-flow save path also keeps the kind, fields and availability.
CREATE OR REPLACE FUNCTION public.save_products_with_visual_flow(p_business uuid, p_user uuid, p_revision integer, p_flow text, p_mode text, p_products jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
    item_kind=coalesce(nullif(item->>'item_kind',''),item_kind),
    attributes=case when jsonb_typeof(item->'attributes')='object' then item->'attributes' else attributes end,
    availability=coalesce(nullif(item->>'availability',''),availability),
    updated_at=clock_timestamp() where id=old_product.id and business_id=p_business returning * into saved;
  else
   insert into public.products(business_id,name,description,image_url,price_amount,currency,sku,external_id,product_type_id,is_active,source,item_kind,attributes,availability)
   values(p_business,item->>'name',item->>'description',item->>'image_url',(item->>'price_amount')::numeric,item->>'currency',nullif(item->>'sku',''),nullif(item->>'external_id',''),(item->>'product_type_id')::uuid,
    case when p_mode='create' then coalesce((item->>'is_active')::boolean,false) else false end,'manual',
    coalesce(nullif(item->>'item_kind',''),'product'),
    case when jsonb_typeof(item->'attributes')='object' then item->'attributes' else '{}'::jsonb end,
    coalesce(nullif(item->>'availability',''),'available')) returning * into saved;
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
end $function$;

commit;
