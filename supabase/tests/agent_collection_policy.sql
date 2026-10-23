-- Only run via the disposable socket-only conversation_transport.py runner.
begin;
do $$ begin
 if inet_server_addr() is not null then raise exception 'local_socket_required'; end if;
end $$;
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','collection-owner@test.invalid'),
 ('10000000-0000-4000-8000-000000000002','collection-foreign@test.invalid');
insert into public.businesses(id,name,slug) values
 ('10000000-0000-4000-8000-000000000010','Collection synthetic','collection-synthetic'),
 ('10000000-0000-4000-8000-000000000020','Foreign synthetic','collection-foreign');
insert into public.business_users(business_id,user_id,role) values
 ('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001','owner'),
 ('10000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000002','owner');
insert into public.booking_services(id,business_id,name,is_active,duration_minutes) values
 ('10000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-000000000010','Synthetic quote',true,30);
insert into public.visual_workflow_versions(id,business_id,graph,created_by) values
 ('10000000-0000-4000-8000-000000000040','10000000-0000-4000-8000-000000000010',
 '{"version":2,"name":"Collection","nodes":[{"id":"start","kind":"start","label":"Start","position":{"x":0,"y":0},"config":{}},{"id":"details","kind":"collect","label":"Details","position":{"x":0,"y":0},"config":{"fieldKey":"project_type","prompt":"Project?","fieldType":"text"}},{"id":"end","kind":"end","label":"End","position":{"x":0,"y":0},"config":{}}],"edges":[{"id":"s-e","source":"start","target":"end","port":"next"},{"id":"d-e","source":"details","target":"end","port":"next"}],"flows":[{"id":"quote","kind":"custom","label":"Quote","entryNodeId":"details","nodeIds":["details"],"serviceIds":["10000000-0000-4000-8000-000000000030"]}]}',
 '10000000-0000-4000-8000-000000000001');
create function pg_temp.check_policy_error(actor uuid, revision integer, scopes jsonb, expected text) returns void language plpgsql as $$
begin
 begin
  perform public.save_agent_collection_policy('10000000-0000-4000-8000-000000000010',actor,revision,scopes);
 exception when others then if sqlerrm=expected then return; end if; raise; end;
 raise exception 'Expected rejection: %',expected;
end $$;
do $$ declare scopes jsonb:='[{"versionId":"10000000-0000-4000-8000-000000000040","flowId":"quote","domain":"service","mode":"collection_only","profileFields":[]}]';
 owner_id uuid:='10000000-0000-4000-8000-000000000001'; rev integer;
begin
 if exists(select 1 from public.businesses where agent_collection_policy is not null) then raise exception 'legacy_default_changed'; end if;
 perform pg_temp.check_policy_error('10000000-0000-4000-8000-000000000002',0,scopes,'unauthorized');
 rev:=public.save_agent_collection_policy('10000000-0000-4000-8000-000000000010',owner_id,0,scopes);
 if rev<>1 then raise exception 'bad_revision'; end if;
 perform pg_temp.check_policy_error(owner_id,0,scopes,'stale_collection_policy');
 perform pg_temp.check_policy_error(owner_id,1,scopes||scopes,'duplicate_collection_scope');
 perform pg_temp.check_policy_error(owner_id,1,jsonb_set(scopes,'{0,versionId}','"10000000-0000-4000-8000-000000000099"'),'collection_version_unavailable');
 perform pg_temp.check_policy_error(owner_id,1,jsonb_set(scopes,'{0,domain}','"order"'),'collection_domain_mismatch');
 perform pg_temp.check_policy_error(owner_id,1,jsonb_set(scopes,'{0,mode}','"execute_everything"'),'invalid_collection_scope');
 if (select agent_collection_policy->>'revision' from public.businesses where id='10000000-0000-4000-8000-000000000010')<>'1' then raise exception 'failed_write_not_atomic'; end if;
 if has_function_privilege('anon','public.save_agent_collection_policy(uuid,uuid,integer,jsonb)','execute')
  or has_function_privilege('authenticated','public.save_agent_collection_policy(uuid,uuid,integer,jsonb)','execute')
  or not has_function_privilege('service_role','public.save_agent_collection_policy(uuid,uuid,integer,jsonb)','execute') then raise exception 'unsafe_grants'; end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid='public.save_agent_collection_policy(uuid,uuid,integer,jsonb)'::regprocedure
   and p.prosecdef and p.proconfig @> array['search_path=pg_catalog, pg_temp']
   and p.proowner=(select relowner from pg_catalog.pg_class where oid='public.businesses'::regclass)) then raise exception 'unsafe_function_owner_or_path'; end if;
 if exists(select 1 from pg_catalog.pg_proc p where p.oid='public.guard_agent_collection_policy()'::regprocedure and p.prosecdef)
   or has_function_privilege('authenticated','public.guard_agent_collection_policy()','execute') then raise exception 'unsafe_trigger'; end if;
end $$;
set local role service_role;
do $$ begin
 begin
  update public.businesses set agent_collection_policy=null where id='10000000-0000-4000-8000-000000000010';
 exception when others then if sqlerrm='collection_policy_server_owned' then return; end if; raise; end;
 raise exception 'direct_update_bypassed_policy';
end $$;
reset role;
insert into public.conversations(id,business_id,channel,instagram_participant_id) values
 ('10000000-0000-4000-8000-000000000050','10000000-0000-4000-8000-000000000010','instagram','synthetic');
insert into public.conversation_states(conversation_id,business_id,collected) values
 ('10000000-0000-4000-8000-000000000050','10000000-0000-4000-8000-000000000010','{"visual":{"versionId":"10000000-0000-4000-8000-000000000040"}}');
select pg_temp.check_policy_error('10000000-0000-4000-8000-000000000001',1,'[]','collection_version_in_use');
delete from public.business_users where business_id='10000000-0000-4000-8000-000000000010';
select pg_temp.check_policy_error('10000000-0000-4000-8000-000000000001',1,'[]','unauthorized');
select 'PASS configuration CAS, tenant/owner checks, revocation, direct write denial, grants, atomic rollback, used-version freeze';
rollback;
