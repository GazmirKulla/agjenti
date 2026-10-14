-- Read-only, one result for SQL Editor. Capture BEFORE W0-B and archive with the
-- project ref/environment. No customer records or credentials are read.
-- rollback_sql restores ONLY the exact client write grants being removed,
-- including column scope, grant option and grantor. It does NOT execute them.
-- Rollback reopens the legacy boundary: separate approval and a privileged role
-- able to act as each recorded grantor are required. Never use GRANT ALL instead.
with targets as (
  select oid,relname,relowner,relacl from pg_catalog.pg_class
  where oid in ('public.orders'::regclass,'public.order_items'::regclass)
), grants as (
  select t.relname,null::text as column_name,a.grantor,a.grantee,a.privilege_type,a.is_grantable
  from targets t cross join lateral pg_catalog.aclexplode(coalesce(t.relacl,pg_catalog.acldefault('r',t.relowner))) a
  union all
  select t.relname,c.attname,a.grantor,a.grantee,a.privilege_type,a.is_grantable
  from targets t join pg_catalog.pg_attribute c on c.attrelid=t.oid
  cross join lateral pg_catalog.aclexplode(c.attacl) a
  where c.attnum>0 and not c.attisdropped
), named as (
  select relname,column_name,pg_catalog.pg_get_userbyid(grantor) as grantor,
    case when grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(grantee) end as grantee,
    privilege_type,is_grantable from grants
), restoration as (
  select *,format('GRANT %s%s ON TABLE public.%I TO %I%s GRANTED BY %I;',
    privilege_type,case when column_name is null then '' else format(' (%I)',column_name) end,
    relname,grantee,case when is_grantable then ' WITH GRANT OPTION' else '' end,grantor) as statement
  from named where grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
)
select jsonb_build_object(
  'database',current_database(),'captured_at',current_timestamp,
  'target_count',(select count(*) from targets),
  'grants',coalesce((select jsonb_agg(to_jsonb(n) order by relname,column_name nulls first,grantee,grantor,privilege_type) from named n),'[]'::jsonb),
  'rollback_sql','BEGIN;'||E'\n'||coalesce((select string_agg(statement,E'\n' order by relname,column_name nulls first,grantee,grantor,privilege_type) from restoration),'-- No client write grants to restore.')||E'\nCOMMIT;'
) as order_write_boundary_snapshot;
