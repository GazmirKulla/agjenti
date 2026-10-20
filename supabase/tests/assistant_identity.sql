-- Local disposable PostgreSQL only. No providers, execution or persistent fixtures.
-- Set agjenti.assistant_test='local-disposable' after independently checking isolation.
-- Run with psql -X -v ON_ERROR_STOP=1; every fixture is rolled back.
begin;
do $$ begin
  if current_setting('agjenti.assistant_test',true) is distinct from 'local-disposable'
    or inet_server_addr() is not null then
    raise exception 'Use an independently verified local disposable database via Unix socket';
  end if;
end $$;
create temp table assistant_identity_fixture as select
  gen_random_uuid() business,gen_random_uuid() other_business,gen_random_uuid() owner_id,
  gen_random_uuid() peer_id,gen_random_uuid() stranger_id,gen_random_uuid() conversation,gen_random_uuid() request;
grant select on assistant_identity_fixture to authenticated,service_role;
do $$ declare f record; suffix text; base_name text; legacy_name text; begin
  select * into f from assistant_identity_fixture;
  foreach suffix in array array['conversations','messages','plan_snapshots'] loop
    base_name:='public.assistant_'||suffix; legacy_name:='public.migo_'||suffix;
    if not exists(select 1 from pg_class where oid=base_name::regclass and relkind='r' and relrowsecurity)
      or not exists(select 1 from pg_class where oid=legacy_name::regclass and relkind='v'
        and reloptions @> array['security_invoker=true']) then
      raise exception 'Missing RLS table / invoker view: %',suffix;
    end if;
    if has_table_privilege('anon',base_name,'select') or has_table_privilege('anon',legacy_name,'select')
      or has_table_privilege('authenticated',base_name,'insert,update,delete')
      or has_table_privilege('authenticated',legacy_name,'insert,update,delete') then
      raise exception 'Unexpected client write or anon read grants: %',suffix;
    end if;
    if suffix<>'conversations' and
      (has_table_privilege('service_role',base_name,'update') or has_table_privilege('service_role',legacy_name,'update')) then
      raise exception 'Immutable messages/plans became mutable';
    end if;
  end loop;
  foreach base_name in array array['write_assistant_conversation','write_migo_conversation'] loop
    legacy_name:='public.'||base_name||'(uuid,uuid,uuid,text,integer,uuid,jsonb)';
    if has_function_privilege('anon',legacy_name,'execute')
      or has_function_privilege('authenticated',legacy_name,'execute')
      or not has_function_privilege('service_role',legacy_name,'execute')
      or (select prosecdef from pg_proc where oid=legacy_name::regprocedure) then
      raise exception 'Writer ACL/security changed: %',base_name;
    end if;
  end loop;
  insert into auth.users(id) values(f.owner_id),(f.peer_id),(f.stranger_id);
  insert into public.businesses(id,name,slug) values
    (f.business,'Synthetic assistant rename',f.business::text),
    (f.other_business,'Synthetic foreign tenant',f.other_business::text);
  insert into public.business_users(business_id,user_id,role) values
    (f.business,f.owner_id,'owner'),(f.business,f.peer_id,'owner'),(f.other_business,f.stranger_id,'owner');
end $$;

set local role service_role;
do $$ declare f record; replay jsonb; begin
  select * into f from assistant_identity_fixture;
  -- Old deployment starts a turn; the new deployment finishes the SAME turn.
  perform public.write_migo_conversation(f.business,f.owner_id,f.conversation,'create');
  perform public.write_migo_conversation(f.business,f.owner_id,f.conversation,'begin',0,f.request,
    jsonb_build_object('content','Synthetic request','fingerprint',repeat('a',64)));
  replay:=public.write_assistant_conversation(f.business,f.owner_id,f.conversation,'begin',0,f.request,
    jsonb_build_object('content','Synthetic request','fingerprint',repeat('a',64)));
  if replay->>'duplicate' is distinct from 'true' then raise exception 'Mixed RPC deduplication failed'; end if;
  perform public.write_assistant_conversation(f.business,f.owner_id,f.conversation,'finish',null,f.request,
    '{"content":"Synthetic proposal, not execution","snapshot":{"version":1,"request":"Synthetic request"}}');
  perform public.write_migo_conversation(f.business,f.owner_id,f.conversation,'preferences',1,null,'{"step":"included"}');
  begin
    perform public.write_assistant_conversation(f.business,f.owner_id,f.conversation,'preferences',1,null,'{}');
    raise exception 'Stale plan revision accepted';
  exception when raise_exception then
    if sqlerrm<>'migo_revision_conflict' then raise; end if;
  end;
  begin
    perform public.write_assistant_conversation(f.other_business,f.owner_id,f.conversation,'rename',3,null,'{"title":"forged"}');
    raise exception 'Cross-tenant writer accepted';
  exception when raise_exception then
    if sqlerrm<>'migo_forbidden' then raise; end if;
  end;
end $$;
reset role;

do $$ declare f record; begin
  select * into f from assistant_identity_fixture;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
end $$;
set local role authenticated;
do $$ declare f record; begin
  select * into f from assistant_identity_fixture;
  if (select count(*) from public.assistant_conversations where id=f.conversation)<>1
    or (select count(*) from public.migo_conversations where id=f.conversation)<>1
    or (select count(*) from public.assistant_messages where conversation_id=f.conversation)<>2
    or (select count(*) from public.migo_messages where conversation_id=f.conversation)<>2
    or (select count(*) from public.assistant_plan_snapshots where conversation_id=f.conversation)<>2
    or (select count(*) from public.migo_plan_snapshots where conversation_id=f.conversation)<>2 then
    raise exception 'Authorized history differs through legacy and canonical names';
  end if;
end $$;
reset role;
do $$ declare f record; who uuid; begin
  select * into f from assistant_identity_fixture;
  foreach who in array array[f.peer_id,f.stranger_id] loop
    perform set_config('request.jwt.claim.sub',who::text,true);
    set local role authenticated;
    if exists(select 1 from public.migo_conversations where id=f.conversation)
      or exists(select 1 from public.assistant_conversations where id=f.conversation)
      or exists(select 1 from public.migo_messages where conversation_id=f.conversation)
      or exists(select 1 from public.assistant_messages where conversation_id=f.conversation)
      or exists(select 1 from public.migo_plan_snapshots where conversation_id=f.conversation)
      or exists(select 1 from public.assistant_plan_snapshots where conversation_id=f.conversation) then
      raise exception 'Legacy/canonical RLS leaked private history';
    end if;
    reset role;
  end loop;
  delete from public.business_users where business_id=f.business and user_id=f.owner_id;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  set local role authenticated;
  if exists(select 1 from public.migo_messages where conversation_id=f.conversation)
    or exists(select 1 from public.assistant_messages where conversation_id=f.conversation) then
    raise exception 'Revoked membership still reads history';
  end if;
  reset role;
  set local role service_role;
  begin
    perform public.write_migo_conversation(f.business,f.owner_id,f.conversation,'rename',3,null,'{"title":"forged"}');
    raise exception 'Revoked membership still writes through legacy RPC';
  exception when raise_exception then
    if sqlerrm<>'migo_forbidden' then raise; end if;
  end;
  reset role;
  insert into public.business_users(business_id,user_id,role) values(f.business,f.owner_id,'owner');
end $$;

set local role service_role;
do $$ declare f record; begin
  select * into f from assistant_identity_fixture;
  perform public.write_migo_conversation(f.business,f.owner_id,f.conversation,'delete',3);
  if exists(select 1 from public.assistant_messages where conversation_id=f.conversation)
    or exists(select 1 from public.migo_plan_snapshots where conversation_id=f.conversation) then
    raise exception 'Legacy deletion did not purge canonical contents';
  end if;
  begin
    perform public.write_assistant_conversation(f.business,f.owner_id,f.conversation,'create');
    raise exception 'Deleted conversation resurrected';
  exception when raise_exception then
    if sqlerrm<>'migo_not_found' then raise; end if;
  end;
end $$;
reset role;
select 'PASS: canonical + legacy RLS, ACL, mixed RPC deduplication, CAS, revocation and deletion' as result;
rollback;
