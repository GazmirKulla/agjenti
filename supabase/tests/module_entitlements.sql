-- Standard modules no longer have package gates. The capability/navigation test
-- covers owner/staff/foreign access, historical policies and the internal RPC ACL.
\ir capability_navigation.sql

-- Exceptional capabilities continue to respect global/package/business policies.
begin;
do $$
declare b uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid();
begin
 insert into auth.users(id) values(actor),(admin_id);
 insert into platform_admins(user_id) values(admin_id);
 insert into businesses(id,name,slug) values(b,'Exceptional capability test','special-'||b);
 insert into business_users(business_id,user_id,role) values(b,actor,'owner');
 if can_execute_business_action(b,actor,'business.provision',false) then raise exception 'default exceptional power opened'; end if;
 perform save_action_policy(admin_id,'business',b::text,'business.provision',true);
 if not can_execute_business_action(b,actor,'business.provision',false) then raise exception 'explicit exceptional permission lost'; end if;
 perform save_business_action_settings(b,actor,'business.provision',false,true,7);
 if not can_execute_business_action(b,null,'business.provision',true) then raise exception 'configured automation denied'; end if;
 perform save_action_policy(admin_id,'global','','business.provision',false);
 if can_execute_business_action(b,actor,'business.provision',false) or can_execute_business_action(b,null,'business.provision',true) then raise exception 'global restriction ignored'; end if;
end $$;
rollback;
