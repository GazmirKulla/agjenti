-- Transactional fixtures only. No providers, messages, notifications or real records.
begin;
do $$
declare b uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); denied boolean;
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner_id,'cap-owner-'||owner_id||'@test.invalid',now()),(outsider,'cap-other-'||outsider||'@test.invalid',now()),(staff_id,'cap-staff-'||staff_id||'@test.invalid',now());
 insert into businesses(id,name,slug) values(b,'Capability test','cap-test-'||b),(other,'Other test','cap-test-'||other);
 insert into business_users(business_id,user_id,role) values(b,owner_id,'owner'),(b,staff_id,'staff'),(other,outsider,'owner');
 -- Historical package/module overrides no longer block ordinary work.
 insert into business_actions(business_id,action_key,enabled) values(b,'module.services',false),(b,'service.create',false),(b,'module.workflows',false);
 if not business_module_allowed(b,'services') or not business_module_allowed(b,'staff') or business_module_allowed(b,'unknown') then raise exception 'incorrect capability registry'; end if;
 if not can_execute_business_action(b,owner_id,'service.create',false) then raise exception 'standard action still requires activation'; end if;
 if can_execute_business_action(b,outsider,'service.create',false) then raise exception 'cross tenant action allowed'; end if;
 if can_execute_business_action(b,owner_id,'business.provision',false) then raise exception 'exceptional capability opened'; end if;
 insert into business_action_settings(business_id,action_key,staff_allowed) values(b,'service.create',false);
 if can_execute_business_action(b,staff_id,'service.create',false) then raise exception 'staff permission ignored'; end if;
 perform save_business_modules(b,owner_id,'{"version":1,"source":"manual","enabledModules":["bookings"],"hiddenModules":["services"]}');
 insert into booking_services(business_id,name,duration_minutes) values(b,'Test service',30);
 if not 'services'=any(business_used_modules(b)) or 'services'=any(business_used_modules(other)) then raise exception 'usage is not tenant scoped'; end if;
 insert into ai_agents(business_id,name) values(b,'Navigation test');
 insert into business_intelligence_sources(business_id,source,status) values(b,'manual','completed');
 if not array['agents','sources'] <@ business_used_modules(b) or array['agents','sources'] && business_used_modules(other) then raise exception 'configured usage is not tenant scoped'; end if;
 if not business_module_allowed(b,'services') then raise exception 'hidden navigation blocked capability'; end if;
 denied:=false;
 begin perform save_business_modules(b,outsider,'{"version":1,"source":"manual","enabledModules":[]}'); exception when others then denied:=sqlerrm='unauthorized'; end;
 if not denied then raise exception 'foreign owner changed preferences'; end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 execute 'set local role authenticated';
 if exists(select 1 from booking_services where business_id=b) then raise exception 'foreign records visible'; end if;
 denied:=false;
 begin insert into booking_services(business_id,name,duration_minutes) values(b,'Forbidden',30); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'foreign record writable'; end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 execute 'set local role authenticated';
 if not exists(select 1 from booking_services where business_id=b) then raise exception 'own records hidden by navigation'; end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub','',true);
 if has_function_privilege('authenticated','public.business_used_modules(uuid)','execute')
 or has_function_privilege('anon','public.business_used_modules(uuid)','execute')
 or has_function_privilege('authenticated','public.save_business_modules(uuid,uuid,jsonb)','execute') then raise exception 'internal actor/usage RPC exposed'; end if;
 if not has_function_privilege('service_role','public.business_used_modules(uuid)','execute') then raise exception 'server cannot load navigation'; end if;
end $$;
select 'capability_navigation: PASS' as result;
rollback;
