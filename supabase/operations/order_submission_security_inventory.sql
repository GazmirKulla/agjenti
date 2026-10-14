-- W4-SEC: read-only metadata evidence, no customer rows or secret configuration.
-- Run only with approval for the target environment; archive output + environment
-- identity/date. Local shim grants are NOT hosted Supabase/PostgREST evidence.
-- Candidate routine/view discovery is heuristic; inspect wrappers/dynamic SQL
-- and the actual PostgREST exposed-schema configuration separately.
begin read only;
set local search_path=pg_catalog,pg_temp;

select current_database() as database_name,current_user as inspected_by,
  current_timestamp as inspected_at,current_setting('server_version') as postgres_version;

select r.rolname,r.rolsuper,r.rolbypassrls,r.rolinherit,r.rolcanlogin,
  has_schema_privilege(r.oid,'public','USAGE') as public_usage,
  has_schema_privilege(r.oid,'public','CREATE') as public_create,
  has_database_privilege(r.oid,current_database(),'TEMP') as temporary_tables
from pg_roles r where r.rolname in ('anon','authenticated','service_role','authenticator') order by r.rolname;

-- Effective rights include PUBLIC/inherited grants. Inspect column rights too,
-- both for post-revocation verification and exact restoration of the original ACL.
select c.oid::regclass as relation,pg_get_userbyid(c.relowner) as owner,
  c.relrowsecurity,c.relforcerowsecurity,c.relacl,r.rolname,
  has_table_privilege(r.oid,c.oid,'SELECT') as can_select,
  has_table_privilege(r.oid,c.oid,'INSERT') as can_insert,
  has_any_column_privilege(r.oid,c.oid,'INSERT') as can_insert_columns,
  has_table_privilege(r.oid,c.oid,'UPDATE') as can_update,
  has_any_column_privilege(r.oid,c.oid,'UPDATE') as can_update_columns,
  has_table_privilege(r.oid,c.oid,'DELETE') as can_delete,
  has_table_privilege(r.oid,c.oid,'TRUNCATE') as can_truncate
from pg_class c cross join pg_roles r
where c.oid in ('public.orders'::regclass,'public.order_items'::regclass,'public.order_submissions'::regclass)
  and r.rolname in ('anon','authenticated','service_role','authenticator') order by relation,r.rolname;

select a.attrelid::regclass as relation,a.attname,a.attacl from pg_attribute a
where a.attrelid in ('public.orders'::regclass,'public.order_items'::regclass,'public.order_submissions'::regclass)
  and a.attnum>0 and not a.attisdropped and a.attacl is not null order by relation,a.attnum;

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('orders','order_items','order_submissions') order by tablename,policyname;

select t.tgrelid::regclass as relation,t.tgname,t.tgenabled,t.tgfoid::regprocedure as function,
  pg_get_triggerdef(t.oid) as definition from pg_trigger t
where not t.tgisinternal and t.tgrelid in
  ('public.orders'::regclass,'public.order_items'::regclass,'public.order_submissions'::regclass) order by relation,t.tgname;

-- Includes read-only order-reporting RPCs and RLS helpers, not just W4 writers.
select p.oid::regprocedure as routine,pg_get_userbyid(p.proowner) as owner,p.prosecdef,
  array(select setting from unnest(p.proconfig) setting where setting like 'search_path=%') as search_path,
  p.proacl,r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE') as can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_roles r
where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
  and p.prokind in ('f','p') and (p.proname ~ 'order|is_business_member|is_platform_admin'
    or p.prosrc ~ '\m(orders|order_items|order_submissions)\M')
  and r.rolname in ('anon','authenticated','service_role','authenticator') order by routine,r.rolname;

-- Views can provide a separate REST path; no view bodies/customer data emitted.
select c.oid::regclass as candidate_view,pg_get_userbyid(c.relowner) as owner,c.relacl,c.reloptions
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('v','m') and n.nspname not in ('pg_catalog','information_schema')
  and pg_get_viewdef(c.oid,true) ~ '\m(orders|order_items|order_submissions)\M' order by candidate_view;

select pg_get_userbyid(d.defaclrole) as creator,n.nspname as schema_name,d.defaclobjtype,d.defaclacl
from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
where d.defaclnamespace=0 or n.nspname='public' order by creator,schema_name,d.defaclobjtype;

select parent.rolname as granted_role,member.rolname as member_role,m.admin_option
from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member
order by member_role,granted_role;

-- Only allowlisted PostgREST metadata, never dump all role/server settings.
select coalesce(d.datname,'ALL') as database_name,coalesce(r.rolname,'ALL') as role_name,setting
from pg_db_role_setting s left join pg_database d on d.oid=s.setdatabase left join pg_roles r on r.oid=s.setrole
cross join lateral unnest(s.setconfig) setting
where split_part(setting,'=',1) in ('pgrst.db_schemas','pgrst.db_extra_search_path','pgrst.db_pre_request')
order by database_name,role_name,setting;
rollback;
