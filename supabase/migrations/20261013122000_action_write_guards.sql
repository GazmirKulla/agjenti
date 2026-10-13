begin;
create function public.current_user_can_create_product(p_business uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.can_execute_business_action(p_business,auth.uid(),'product.create',false)
$$;
revoke all on function public.current_user_can_create_product(uuid) from public,anon;
grant execute on function public.current_user_can_create_product(uuid) to authenticated;
-- Restrictive INSERT policies complement the existing tenant policies.
create policy products_action_insert on public.products as restrictive for insert to authenticated
 with check(public.current_user_can_create_product(business_id));

alter function public.save_products_with_visual_flow(uuid,uuid,integer,text,text,jsonb) rename to save_products_with_visual_flow_before_actions;
create function public.save_products_with_visual_flow(p_business uuid,p_user uuid,p_revision integer,p_flow text,p_mode text,p_products jsonb)
returns integer language plpgsql security definer set search_path=public as $$
begin
 if p_mode in ('create','import') and not can_execute_business_action(p_business,p_user,'product.create',false) then raise exception 'action_denied'; end if;
 return save_products_with_visual_flow_before_actions(p_business,p_user,p_revision,p_flow,p_mode,p_products);
end $$;
alter function public.apply_product_csv_import(uuid,uuid,uuid,jsonb) rename to apply_product_csv_import_before_actions;
create function public.apply_product_csv_import(p_business uuid,p_user uuid,p_id uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path=public as $$
begin
 if not can_execute_business_action(p_business,p_user,'product.create',false) then raise exception 'action_denied'; end if;
 return apply_product_csv_import_before_actions(p_business,p_user,p_id,p_rows);
end $$;
revoke all on function public.save_products_with_visual_flow_before_actions(uuid,uuid,integer,text,text,jsonb),public.apply_product_csv_import_before_actions(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.save_products_with_visual_flow(uuid,uuid,integer,text,text,jsonb),public.apply_product_csv_import(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_products_with_visual_flow(uuid,uuid,integer,text,text,jsonb),public.apply_product_csv_import(uuid,uuid,uuid,jsonb) to service_role;
-- Covers every publication path, including assistant RPCs and history restore.
create function public.guard_action_workflow_publication() returns trigger language plpgsql security definer set search_path=public as $$
declare g jsonb; actor uuid;
begin
 if tg_table_name='visual_workflow_versions' then g:=new.graph; actor:=new.created_by;
 else
  if not new.enabled then return new; end if;
  if tg_op='UPDATE' and old.enabled and new.published_version_id is not distinct from old.published_version_id then return new; end if;
  select graph into g from visual_workflow_versions where id=new.published_version_id and business_id=new.business_id;
  actor:=new.updated_by;
 end if;
 if exists(select 1 from jsonb_array_elements(g->'nodes') n where n->>'kind'='action') then
  if not can_execute_business_action(new.business_id,actor,'business.provision',false) or not can_execute_business_action(new.business_id,null,'business.provision',true) then raise exception 'action_denied'; end if;
 end if;
 return new;
end $$;
create trigger action_version_authorization before insert on public.visual_workflow_versions for each row execute function public.guard_action_workflow_publication();
create trigger action_activation_authorization before insert or update on public.visual_workflows for each row execute function public.guard_action_workflow_publication();
revoke all on function public.guard_action_workflow_publication() from public,anon,authenticated,service_role;
commit;
