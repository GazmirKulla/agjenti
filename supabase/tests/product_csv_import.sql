-- Execute in an isolated local database after the migration. Fixtures roll back.
begin;
do $$
declare b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid(); rows jsonb; snapshot jsonb; n integer; failed boolean;
begin
 insert into businesses(id,name,slug,catalog_source) values(b,'CSV test',b::text,'internal'),(other_b,'Other test',other_b::text,'internal');
 insert into auth.users(id) values(u); insert into profiles(id) values(u) on conflict do nothing;
 insert into business_users(business_id,user_id,role) values(b,u,'owner');
 insert into products(id,business_id,name,sku,price_amount,currency,description,is_active) values(p,b,'Existing','TEST-CSV-1',520,'ALL','Preserve',true);
 select to_jsonb(products) into snapshot from products where id=p;
 rows:=jsonb_build_array(jsonb_build_object('id',p,'before',snapshot,'patch',jsonb_build_object('price_amount',790)),jsonb_build_object('id',null,'patch',jsonb_build_object('name','New','sku','TEST-CSV-2','price_amount',20,'currency','ALL')));
 n:=apply_product_csv_import(b,u,receipt,rows);
 if n<>2 or (select price_amount from products where id=p)<>790 or not(select is_active from products where id=p) or (select description from products where id=p)<>'Preserve' or (select is_active from products where business_id=b and sku='TEST-CSV-2') then raise exception 'incorrect_commit'; end if;
 n:=apply_product_csv_import(b,u,receipt,rows);
 if n<>2 or (select count(*) from products where business_id=b)<>2 then raise exception 'retry_duplicated'; end if;
 -- A valid first write and stale second write must roll back together.
 select to_jsonb(products) into snapshot from products where id=p;
 rows:=jsonb_build_array(jsonb_build_object('id',null,'patch',jsonb_build_object('name','Rollback','sku','TEST-CSV-3')),jsonb_build_object('id',p,'before',jsonb_set(snapshot,'{price_amount}','520'),'patch',jsonb_build_object('price_amount',800)));
 failed:=false;
 begin perform apply_product_csv_import(b,u,gen_random_uuid(),rows); exception when others then if sqlerrm<>'stale_product' then raise; end if; failed:=true; end;
 if not failed or exists(select 1 from products where business_id=b and sku='TEST-CSV-3') then raise exception 'partial_commit'; end if;
 -- Tenant isolation and receipt ownership.
 failed:=false;
 begin perform apply_product_csv_import(other_b,u,receipt,'[]'); exception when others then if sqlerrm<>'unauthorized' then raise; end if; failed:=true; end;
 if not failed then raise exception 'unauthorized_accepted'; end if;
 -- Duplicate SKU in a later row also rolls back the earlier update.
 rows:=jsonb_build_array(jsonb_build_object('id',p,'before',snapshot,'patch',jsonb_build_object('price_amount',900)),jsonb_build_object('id',null,'patch',jsonb_build_object('name','Duplicate','sku','test-csv-2')));
 failed:=false;
 begin perform apply_product_csv_import(b,u,gen_random_uuid(),rows); exception when others then if sqlerrm<>'stale_catalog' then raise; end if; failed:=true; end;
 if not failed or (select price_amount from products where id=p)<>790 then raise exception 'duplicate_partial_commit'; end if;
 if has_function_privilege('authenticated','public.apply_product_csv_import(uuid,uuid,uuid,jsonb)','execute') then raise exception 'public_mutation'; end if;
end $$;
rollback;
