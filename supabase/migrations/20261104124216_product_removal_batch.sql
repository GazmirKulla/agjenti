begin;
-- One predicate for preflight and the existing deletion guard.
create function public.product_has_history(p_business uuid,p_product uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from public.order_items where product_id=p_product)
 or exists(select 1 from public.product_workflow_drafts where product_id=p_product)
 or exists(select 1 from public.visual_workflow_versions where business_id=p_business and position(p_product::text in graph::text)>0)
 or exists(select 1 from public.visual_workflows where business_id=p_business and position(p_product::text in draft::text)>0)
 or exists(select 1 from public.conversation_states where business_id=p_business and position(p_product::text in collected::text)>0);
$$;
revoke all on function public.product_has_history(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.protect_product_history() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not exists(select 1 from public.businesses where id=old.business_id) then return old; end if;
 if public.product_has_history(old.business_id,old.id) then raise exception 'product_has_history'; end if;
 return old;
end $$;

create function public.prepare_product_removal(p_business uuid,p_user uuid,p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
 perform public.assert_business_operator(p_business,p_user);
 if (select catalog_source from public.businesses where id=p_business)='external' then raise exception 'external_catalog'; end if;
 if p_ids is null or cardinality(p_ids) not between 1 and 100 or array_position(p_ids,null) is not null
 or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id) then raise exception 'invalid_batch_targets'; end if;
 select jsonb_agg(jsonb_build_object('id',id,'name',name,'updated_at',updated_at,
   'operation',case when public.product_has_history(p_business,id) then 'archive' else 'delete' end) order by id)
 into result from public.products where business_id=p_business and id=any(p_ids);
 if coalesce(jsonb_array_length(result),0)<>cardinality(p_ids) then raise exception 'invalid_batch_targets'; end if;
 return result;
end $$;
revoke all on function public.prepare_product_removal(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.prepare_product_removal(uuid,uuid,uuid[]) to service_role;

-- Exact reviewed rows only. A stale row or a new history reference rolls back
-- the entire batch; never silently change a reviewed deletion into an archive.
create function public.execute_product_removal(p_business uuid,p_user uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare item jsonb; p public.products; removed integer:=0; archived integer:=0; ids uuid[];
begin
 perform public.assert_business_operator(p_business,p_user);
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'invalid_batch_targets'; end if;
 select array_agg((value->>'id')::uuid) into ids from jsonb_array_elements(p_rows);
 if array_position(ids,null) is not null or cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then raise exception 'invalid_batch_targets'; end if;
 -- Consistent lock order, also shared with individual lifecycle operations.
 perform 1 from public.businesses where id=p_business for share;
 if (select catalog_source from public.businesses where id=p_business)='external' then raise exception 'external_catalog'; end if;
 perform 1 from public.products where business_id=p_business and id=any(ids) order by id for update;
 for item in select value from jsonb_array_elements(p_rows) order by value->>'id' loop
  select * into p from public.products where business_id=p_business and id=(item->>'id')::uuid;
  if not found or p.updated_at is distinct from (item->>'updated_at')::timestamptz then raise exception 'stale_product'; end if;
  if item->>'operation' is null or item->>'operation' not in ('delete','archive') then raise exception 'invalid_operation'; end if;
  perform public.product_lifecycle(p_business,p_user,p.id,p.updated_at,item->>'operation');
  if item->>'operation'='delete' then removed:=removed+1; else archived:=archived+1; end if;
 end loop;
 return jsonb_build_object('deleted',removed,'archived',archived);
end $$;
revoke all on function public.execute_product_removal(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.execute_product_removal(uuid,uuid,jsonb) to service_role;
commit;
