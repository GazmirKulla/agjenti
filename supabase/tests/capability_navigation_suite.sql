-- Run only via conversation_transport.py --extra-sql in its freshly migrated local cluster.
\set ON_ERROR_STOP on
do $$ begin
 if inet_server_addr() is not null or current_setting('listen_addresses')<>'' then raise exception 'isolated socket-only test cluster required'; end if;
end $$;
create database capability_navigation_w4_test template postgres;
\connect capability_navigation_w4_test
\ir module_entitlements.sql
\echo PASS capability and entitlement SQL
\ir sql_readiness_boundary.sql
\echo PASS publication and execution SQL boundaries
\ir order_submission_security.sql
\echo PASS order submission security
\ir order_write_boundary.sql
\echo PASS order write boundaries
\ir catalog_action_authorization.sql
\echo PASS catalog actor authorization
\ir catalog_activation_readiness.sql
\echo PASS catalog activation readiness

\ir shared_business_operations.sql
\echo PASS shared operations and owner attention
