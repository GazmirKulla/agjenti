-- Run against an isolated database after all migrations. Every fixture rolls back.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000101','discovery-owner@example.test'),
 ('00000000-0000-4000-8000-000000000102','discovery-other@example.test');
do $$
declare
 u uuid:='00000000-0000-4000-8000-000000000101';
 other_user uuid:='00000000-0000-4000-8000-000000000102';
 b uuid; other_business uuid; j business_discovery_jobs; replaced uuid; rev integer;
 entities jsonb; draft jsonb; old_product uuid:=gen_random_uuid(); foreign_product uuid:=gen_random_uuid();
begin
 perform complete_business_onboarding(u,'{"name":"Studio","useCases":[],"onboardingMode":"sources"}','Starter');
 perform complete_business_onboarding(other_user,'{"name":"Other","useCases":[]}','Custom');
 select business_id into b from business_users where user_id=u;
 select business_id into other_business from business_users where user_id=other_user;
 insert into products(id,business_id,name,price_amount,currency,is_active) values(old_product,b,'Manual product',5,'EUR',true),(foreign_product,other_business,'Foreign product',8,'EUR',true);
 perform enqueue_business_discovery(b,u,'website','{"url":"https://shop.test"}');
 select * into j from claim_business_discovery(b);
 if j.status<>'running' or j.attempts<>1 then raise exception 'Claim failed';end if;
 if exists(select 1 from claim_business_discovery(b)) then raise exception 'Double claim allowed';end if;
 if checkpoint_business_discovery(j.id,gen_random_uuid(),'{}','text') then raise exception 'Wrong lease accepted';end if;
 replaced:=enqueue_business_discovery(b,u,'website','{"url":"https://other.test"}');
 if replaced=j.id then raise exception 'Changed URL deduplicated incorrectly';end if;
 if checkpoint_business_discovery(j.id,j.lease_token,'{}','text') then raise exception 'Superseded worker published';end if;
 if enqueue_business_discovery(b,u,'website','{"url":"https://other.test"}')<>replaced then raise exception 'Same active job duplicated';end if;
 select * into j from claim_business_discovery(b);
 update business_discovery_jobs set attempts=3,leased_until=now()-interval '1 second' where id=j.id;
 if exists(select 1 from claim_business_discovery(b)) then raise exception 'Crashed job exceeded retry limit';end if;
 if not exists(select 1 from business_discovery_jobs where id=j.id and status='failed') then raise exception 'Crashed job not failed';end if;
 perform enqueue_business_discovery(b,u,'website','{"url":"https://shop.test"}');
 select * into j from claim_business_discovery(b);
 if not checkpoint_business_discovery(j.id,j.lease_token,'{"text":"Bluza 12 EUR","reference":"https://shop.test","entities":[]}','finish') then raise exception 'Checkpoint failed';end if;
 select * into j from claim_business_discovery(b);
 entities:='[{"id":"00000000-0000-4000-8000-000000000111","target":"product","facts":[{"field":"name","value":"Bluza"},{"field":"price","value":"12"},{"field":"currency","value":"EUR"}]},{"id":"00000000-0000-4000-8000-000000000112","target":"service","facts":[{"field":"name","value":"Konsultim"}]},{"id":"00000000-0000-4000-8000-000000000113","target":"agent","facts":[{"field":"rules","value":"Confirmed instructions"}]}]';
 draft:=jsonb_build_object('entities',entities,'conflicts','[]'::jsonb,'missingInformation','[]'::jsonb,'suggestedClarifications','[]'::jsonb);
 select revision into rev from business_discovery where business_id=b;
 if finish_business_discovery(j.id,j.lease_token,rev-1,draft,'{}') then raise exception 'Concurrent stale draft published';end if;
 begin
  perform confirm_business_discovery(b,u,rev,0,draft,entities,'{}','{}');
  raise exception 'Busy confirmation allowed' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'busy' then raise;end if;end;
 if not finish_business_discovery(j.id,j.lease_token,rev,draft,'{"businessType":"fashion"}') then raise exception 'Finish failed';end if;
 if exists(select 1 from products where id='00000000-0000-4000-8000-000000000111') then raise exception 'Analysis changed operational data';end if;
 if not exists(select 1 from business_intelligence_sources where business_id=b and transcript='Bluza 12 EUR') then raise exception 'Source history lost';end if;
 select revision into rev from business_discovery where business_id=b;
 begin
  perform confirm_business_discovery(b,other_user,rev,0,draft,entities,'{}','{}');
  raise exception 'Cross tenant confirmation allowed' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'unauthorized' then raise;end if;end;
 begin
  perform confirm_business_discovery(b,u,rev,0,draft,jsonb_build_array(jsonb_build_object('id',foreign_product,'target','product','facts',entities->0->'facts')),'{}','{}');
  raise exception 'Cross tenant product overwritten' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'unauthorized_target' then raise;end if;end;
 update businesses set name='Manual correction' where id=b;
 begin
  perform confirm_business_discovery(b,u,rev,0,draft,entities,'{}','{}');
  raise exception 'Newer panel settings overwritten' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'platform_changed' then raise;end if;end;
 if not save_business_discovery(b,rev,draft,'{"businessType":"fashion"}',true) then raise exception 'Refresh failed';end if;
 if save_business_discovery(b,rev,draft,'{}') then raise exception 'Stale edit accepted';end if;
 select revision into rev from business_discovery where business_id=b;
 perform confirm_business_discovery(b,u,rev,0,draft,entities,'{"source":"generated","signals":{"businessType":"fashion"}}','{"name":"Manual correction","useCases":[]}');
 if not exists(select 1 from products p join workflows w on w.id=p.workflow_id where p.id='00000000-0000-4000-8000-000000000111' and p.is_active and p.product_type_id is not null and w.business_id=b) then raise exception 'Product workflow setup failed';end if;
 if not exists(select 1 from products where id=old_product and name='Manual product' and is_active and workflow_id is null) then raise exception 'Existing product changed';end if;
 if not exists(select 1 from ai_agents where id='00000000-0000-4000-8000-000000000113' and is_active) then raise exception 'Agent setup failed';end if;
 if not exists(select 1 from knowledge_entries where business_id=b and intent_key='service' and title='Konsultim') then raise exception 'Service setup failed';end if;
 if (select auto_reply from businesses where id=b) then raise exception 'Automatic replies unexpectedly enabled';end if;
 -- Idempotent retry after a successful atomic confirmation.
 perform confirm_business_discovery(b,u,rev,0,draft,entities,'{}','{}');
 if (select count(*) from products where business_id=b)<>2 then raise exception 'Retry duplicated products';end if;
 if has_function_privilege('authenticated','public.confirm_business_discovery(uuid,uuid,integer,integer,jsonb,jsonb,jsonb,jsonb)','execute')
 or has_function_privilege('authenticated','public.claim_business_discovery(uuid)','execute') then raise exception 'Worker RPC exposed';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
do $$ begin if exists(select 1 from business_discovery) then raise exception 'Cross tenant discovery read';end if;end $$;
reset role;
rollback;
