-- Run only against an isolated test database after both migrations. Rollback
-- leaves no test identities or tenants. PGLite can run this without a server.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','owner@example.test'),
 ('00000000-0000-4000-8000-000000000002','member@example.test'),
 ('00000000-0000-4000-8000-000000000003','admin@example.test'),
 ('00000000-0000-4000-8000-000000000004','failure@example.test');
do $$
declare
 u uuid := '00000000-0000-4000-8000-000000000001';
 a jsonb := '{"name":"Dyqani Test","businessType":"fashion","useCases":["sales"],"productCount":"1-10","productType":"variants","aiMode":"sales","messageVolume":"100-500","teamSize":"solo"}';
 s text;
 b uuid;
 n integer;
begin
 perform public.save_onboarding_draft(u,a,4);
 if not exists(select 1 from public.business_onboarding where user_id=u and step=4 and completed_at is null) then raise exception 'Draft not saved'; end if;
 s := public.complete_business_onboarding(u,a,'Udhëzime test');
 select id into b from public.businesses where slug=s;
 if b is null then raise exception 'Business missing'; end if;
 if not exists(select 1 from public.business_users where business_id=b and user_id=u and role='owner') then raise exception 'Owner missing'; end if;
 if not exists(select 1 from public.ai_agents where business_id=b and instructions='Udhëzime test' and is_active=false) then raise exception 'Agent missing'; end if;
 if exists(select 1 from public.businesses where id=b and auto_reply) then raise exception 'Unexpected automatic sending'; end if;
 if public.complete_business_onboarding(u,a,'Do not overwrite') <> s then raise exception 'Retry created a duplicate'; end if;
 select count(*) into n from public.business_users where user_id=u;
 if n<>1 then raise exception 'Duplicate membership'; end if;
 perform public.save_onboarding_draft(u,'{}',0);
 if not exists(select 1 from public.business_onboarding where user_id=u and step=7 and answers=a and completed_at is not null) then raise exception 'Late save overwrote completed state'; end if;
 -- A membership assigned during the wizard must win without changing that tenant.
 insert into public.business_users(business_id,user_id,role) values(b,'00000000-0000-4000-8000-000000000002','staff');
 if public.complete_business_onboarding('00000000-0000-4000-8000-000000000002',a,'Wrong') <> s then raise exception 'Existing member got a new workspace'; end if;
 insert into public.platform_admins(user_id) values('00000000-0000-4000-8000-000000000003');
 begin
   perform public.complete_business_onboarding('00000000-0000-4000-8000-000000000003',a,'Wrong');
   raise exception 'Admin unexpectedly allowed' using errcode='XX001';
 exception when raise_exception then null;
 end;
 if has_function_privilege('authenticated','public.complete_business_onboarding(uuid,jsonb,text)','execute') or has_function_privilege('anon','public.save_onboarding_draft(uuid,jsonb,integer)','execute') then raise exception 'RPC accessible to untrusted roles'; end if;
 if not has_function_privilege('service_role','public.complete_business_onboarding(uuid,jsonb,text)','execute') then raise exception 'Service role cannot create'; end if;
end $$;
-- Force the last write to fail: all business/member/agent inserts must roll back.
create function public.fail_onboarding_test() returns trigger language plpgsql as $$ begin
 if new.user_id='00000000-0000-4000-8000-000000000004' then raise exception 'Injected storage failure'; end if;
 return new;
end $$;
create trigger fail_onboarding_test before insert on public.business_onboarding for each row execute function public.fail_onboarding_test();
do $$
declare n integer;
begin
 select count(*) into n from public.businesses;
 begin
  perform public.complete_business_onboarding('00000000-0000-4000-8000-000000000004','{"name":"Rollback Test","useCases":["sales"]}','Test');
  raise exception 'Failure not injected' using errcode='XX001';
 exception when raise_exception then null;
 end;
 if (select count(*) from public.businesses)<>n or exists(select 1 from public.business_users where user_id='00000000-0000-4000-8000-000000000004') then raise exception 'Partial workspace persisted'; end if;
end $$;
-- Cross-tenant reads are denied; membership permits the checklist read.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$ begin
 if (select count(*) from public.business_onboarding) <> 0 then raise exception 'Cross-tenant read allowed'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from public.business_onboarding) <> 1 then raise exception 'Member cannot read setup'; end if;
end $$;
reset role;
rollback;
