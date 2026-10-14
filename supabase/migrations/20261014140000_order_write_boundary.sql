-- W0-B. Requires W4 + W4-SEC. No application data, policy or RPC changes.
-- Before rollout: capture order_write_boundary_snapshot.sql, verify dependencies
-- and drain legacy writers. Explicitly opt in in the SAME migration session:
-- SET agjenti.w0b_dependencies_verified = 'on';
-- This acknowledgement is a rollout guard, NOT an authorization mechanism.
begin;
set local search_path=pg_catalog,pg_temp;
do $$
declare target regclass; routine regprocedure; signature text; client text;
begin
  if current_setting('agjenti.w0b_dependencies_verified',true) is distinct from 'on' then
    raise exception 'w0b_dependency_review_required';
  end if;
  foreach target in array array['public.orders'::regclass,'public.order_items'::regclass] loop
    if not (select relrowsecurity from pg_catalog.pg_class where oid=target) then
      raise exception 'w0b_rls_required: %',target;
    end if;
  end loop;
  foreach signature in array array[
    'public.protect_managed_order()',
    'public.assert_order_actor(uuid,uuid)',
    'public.submit_confirmed_order(uuid,uuid,uuid,integer,jsonb,jsonb,boolean)',
    'public.finish_order_submission(uuid,uuid,uuid,text,text)',
    'public.reconcile_order_submission(uuid,uuid,uuid,uuid,text,text,text)'
  ] loop
    routine:=to_regprocedure(signature);
    if routine is null or not exists(select 1 from pg_catalog.pg_proc where oid=routine
      and prosecdef and proconfig @> array['search_path=pg_catalog, pg_temp']) then
      raise exception 'w0b_w4_sec_required: %',signature;
    end if;
    foreach client in array array['anon','authenticated'] loop
      if has_function_privilege(client,routine,'EXECUTE') then
        raise exception 'w0b_unexpected_client_rpc_grant: %',signature;
      end if;
    end loop;
    if signature<>'public.protect_managed_order()' and not has_function_privilege('service_role',routine,'EXECUTE') then
      raise exception 'w0b_service_rpc_required: %',signature;
    end if;
  end loop;
end $$;

-- PostgreSQL also revokes corresponding column privileges. RESTRICT deliberately
-- aborts if clients delegated grants: never cascade into unreviewed dependencies.
-- Do NOT revoke PUBLIC/group grants or change global default privileges here.
revoke insert,update,delete,truncate on public.orders,public.order_items from anon,authenticated restrict;

do $$ declare target regclass; client text; begin
  foreach target in array array['public.orders'::regclass,'public.order_items'::regclass] loop
    foreach client in array array['anon','authenticated'] loop
      if has_table_privilege(client,target,'INSERT,UPDATE,DELETE,TRUNCATE')
        or has_any_column_privilege(client,target,'INSERT,UPDATE') then
        -- Includes PUBLIC, inherited grants, owner/superuser rights and grants
        -- from another grantor. Roll back rather than broaden the revocation.
        raise exception 'w0b_unreviewed_write_privilege: % on %',client,target;
      end if;
    end loop;
  end loop;
end $$;
commit;
