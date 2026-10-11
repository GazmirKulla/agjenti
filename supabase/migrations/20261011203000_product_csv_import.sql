begin;
-- Durable receipts make retrying a confirmed import safe and record its exact changes.
create table public.product_import_receipts (
 id uuid primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 user_id uuid not null,
 changes jsonb not null,
 result_count integer not null,
 created_at timestamptz not null default now()
);
alter table public.product_import_receipts enable row level security;
revoke all on public.product_import_receipts from anon, authenticated;

create function public.apply_product_csv_import(p_business uuid, p_user uuid, p_id uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare item jsonb; patch jsonb; old products; saved products; receipt product_import_receipts; n integer:=0; ids uuid[]:='{}';
begin
 perform 1 from businesses where id=p_business and catalog_source='internal' for update;
 if not found or not (exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 select * into receipt from product_import_receipts where id=p_id;
 if found then
  if receipt.business_id<>p_business or receipt.user_id<>p_user or receipt.changes<>p_rows then raise exception 'invalid_receipt'; end if;
  return receipt.result_count;
 end if;
 if p_id is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'invalid_import'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  patch:=item->'patch'; old:=null;
  if jsonb_typeof(patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(patch) k where k not in ('name','sku','price_amount','currency','description','image_url','product_type_id','workflow_id')) then raise exception 'invalid_fields'; end if;
  if item->>'id' is not null then
   select * into old from products where id=(item->>'id')::uuid and business_id=p_business for update;
   if old.id is null or exists(select 1 from jsonb_each(item->'before') e where case when e.key='updated_at' then old.updated_at is distinct from (e.value#>>'{}')::timestamptz else (to_jsonb(old)->e.key) is distinct from e.value end) then raise exception 'stale_product'; end if;
   if old.id=any(ids) then raise exception 'duplicate_product'; end if;
   ids:=array_append(ids,old.id);
  elsif exists(select 1 from products where business_id=p_business and (lower(btrim(sku))=lower(btrim(patch->>'sku')) or lower(btrim(name))=lower(btrim(patch->>'name')))) then raise exception 'stale_catalog';
  end if;
  if patch ? 'name' and (length(btrim(patch->>'name')) not between 2 and 180) then raise exception 'invalid_name'; end if;
  if patch ? 'price_amount' and ((patch->>'price_amount')::numeric < 0 or (patch->>'price_amount')::numeric > 9999999999.99) then raise exception 'invalid_price'; end if;
  if patch ? 'currency' and (patch->>'currency') !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if patch ? 'product_type_id' and not exists(select 1 from product_types where id=(patch->>'product_type_id')::uuid and is_active) then raise exception 'invalid_product_type'; end if;
  if patch ? 'workflow_id' and not exists(select 1 from workflows where id=(patch->>'workflow_id')::uuid and business_id=p_business) then raise exception 'foreign_workflow'; end if;
  if old.id is not null then
   update products set name=case when patch ? 'name' then patch->>'name' else name end,
    sku=case when patch ? 'sku' then patch->>'sku' else sku end,
    price_amount=case when patch ? 'price_amount' then (patch->>'price_amount')::numeric else price_amount end,
    currency=case when patch ? 'currency' then patch->>'currency' else currency end,
    description=case when patch ? 'description' then patch->>'description' else description end,
    image_url=case when patch ? 'image_url' then patch->>'image_url' else image_url end,
    product_type_id=case when patch ? 'product_type_id' then (patch->>'product_type_id')::uuid else product_type_id end,
    workflow_id=case when patch ? 'workflow_id' then (patch->>'workflow_id')::uuid else workflow_id end,
    updated_at=clock_timestamp() where id=old.id and business_id=p_business returning * into saved;
  else
   if nullif(btrim(patch->>'name'),'') is null then raise exception 'missing_name'; end if;
   insert into products(business_id,name,sku,price_amount,currency,description,image_url,product_type_id,workflow_id,is_active,source)
    values(p_business,patch->>'name',patch->>'sku',(patch->>'price_amount')::numeric,coalesce(patch->>'currency','ALL'),patch->>'description',patch->>'image_url',(patch->>'product_type_id')::uuid,(patch->>'workflow_id')::uuid,false,'manual') returning * into saved;
  end if;
  n:=n+1;
 end loop;
 insert into product_import_receipts(id,business_id,user_id,changes,result_count) values(p_id,p_business,p_user,p_rows,n);
 return n;
end $$;
revoke all on function public.apply_product_csv_import(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_product_csv_import(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
