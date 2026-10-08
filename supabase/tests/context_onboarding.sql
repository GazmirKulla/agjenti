-- Isolated fixtures roll back. Covers automatic preparation and concurrency.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000501','context-owner@example.test'),
 ('00000000-0000-4000-8000-000000000502','context-other@example.test');
do $$
declare u uuid:='00000000-0000-4000-8000-000000000501'; other_user uuid:='00000000-0000-4000-8000-000000000502';
 b uuid; other_b uuid; j business_discovery_jobs; rev integer; starter uuid; foreign_agent uuid;
 knowledge jsonb; draft jsonb:='{"entities":[],"conflicts":[],"missingInformation":[],"suggestedClarifications":[]}';
 profile jsonb:='{"version":1,"source":"generated","signals":{"businessType":"fashion"},"enabledModules":["knowledge"]}';
 agent jsonb; manual jsonb:='{"version":1,"source":"manual","signals":{"businessType":"services"},"enabledModules":["knowledge"]}';
begin
 perform complete_business_onboarding(u,'{"name":"Studio","useCases":[],"onboardingMode":"sources"}','Starter');
 perform complete_business_onboarding(other_user,'{"name":"Other","useCases":[]}','Custom');
 select business_id into b from business_users where user_id=u;
 select business_id into other_b from business_users where user_id=other_user;
 select id into starter from ai_agents where business_id=b;
 select id into foreign_agent from ai_agents where business_id=other_b;
 agent:=jsonb_build_object('id',starter,'expectedInstructions','Starter','instructions','Use verified business knowledge.');
 knowledge:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'target','knowledge','facts',jsonb_build_array(
  jsonb_build_object('field','title','value','Shipping','source','website','evidence','Shipping'),
  jsonb_build_object('field','body','value','We deliver in two days.','source','website','evidence','We deliver in two days.'))));
 perform enqueue_business_discovery(b,u,'website','{"url":"https://shop.test"}');
 select * into j from claim_business_discovery(b);
 select revision into rev from business_discovery where business_id=b;
 if finish_context_business_discovery(j.id,gen_random_uuid(),rev,draft,'{}',knowledge,profile,'{}',agent) then raise exception 'Wrong lease accepted';end if;
 if exists(select 1 from knowledge_entries where business_id=b) then raise exception 'Stale worker saved context';end if;
 if finish_context_business_discovery(j.id,j.lease_token,rev-1,draft,'{}',knowledge,profile,'{}',agent) then raise exception 'Stale revision accepted';end if;
 begin
  perform finish_context_business_discovery(j.id,j.lease_token,rev,draft,'{}',knowledge,profile,'{}',jsonb_set(agent,'{id}',to_jsonb(foreign_agent)));
  raise exception 'Foreign agent accepted' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'unauthorized_target' then raise;end if;end;
 if exists(select 1 from knowledge_entries where business_id=b) then raise exception 'Failed setup did not roll back knowledge';end if;
 if not finish_context_business_discovery(j.id,j.lease_token,rev,draft,'{"businessType":"fashion"}',knowledge,profile,'{"businessType":"fashion","onboardingMode":"sources"}',agent) then raise exception 'Automatic setup failed';end if;
 if not exists(select 1 from ai_agents where id=starter and is_active and instructions='Use verified business knowledge.') then raise exception 'Starter not prepared';end if;
 if (select dashboard_profile from businesses where id=b) is distinct from profile then raise exception 'Generated profile not prepared';end if;
 if not exists(select 1 from knowledge_entries where business_id=b and title='Shipping' and is_active) then raise exception 'Knowledge not saved';end if;
 if exists(select 1 from products where business_id=b) or exists(select 1 from workflows where business_id=b) then raise exception 'Context created an offer/workflow';end if;
 if (select auto_reply from businesses where id=b) then raise exception 'Setup enabled automatic sending';end if;
 if (select tested from jsonb_to_record(business_setup_status(b)) as s(tested boolean)) then raise exception 'Setup faked a test';end if;
 if not exists(select 1 from business_discovery where business_id=b and confirmed_at is not null) then raise exception 'Setup still requires confirmation';end if;
 if (business_setup_status(b)->>'knowledgeCount')::integer<>1 then raise exception 'Knowledge-only status missing';end if;
 insert into instagram_connections(business_id,ig_user_id,access_token_ciphertext) values(b,'context-test','unused');
 begin
  perform launch_business(b,true);
  raise exception 'Untested context launched' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'Setup incomplete' then raise;end if;end;
 insert into business_setup(business_id,tested_signature,tested_at) values(b,business_setup_status(b)->>'signature',now());
 perform launch_business(b,true);
 if not (select auto_reply from businesses where id=b) then raise exception 'Knowledge-only launch failed';end if;
 update businesses set auto_reply=false where id=b;
 update knowledge_entries set is_active=false where business_id=b;
 update business_setup set tested_signature=business_setup_status(b)->>'signature' where business_id=b;
 begin
  perform launch_business(b,true);
  raise exception 'Empty business launched' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'Setup incomplete' then raise;end if;end;
 update knowledge_entries set is_active=true where business_id=b;
 if finish_context_business_discovery(j.id,j.lease_token,rev,draft,'{}',knowledge,profile,'{}',agent) then raise exception 'Completed lease replayed';end if;
 -- Rescanning deduplicates knowledge and keeps manually edited modules/agent.
 update businesses set dashboard_profile=manual where id=b;
 update ai_agents set instructions='Manual correction' where id=starter;
 perform enqueue_business_discovery(b,u,'website','{"url":"https://shop.test"}',true);
 select * into j from claim_business_discovery(b);
 select revision into rev from business_discovery where business_id=b;
 if not finish_context_business_discovery(j.id,j.lease_token,rev,draft,'{}',knowledge,profile,'{}',agent) then raise exception 'Rescan failed';end if;
 if (select dashboard_profile from businesses where id=b)<>manual then raise exception 'Manual modules overwritten';end if;
 if (select instructions from ai_agents where id=starter)<>'Manual correction' then raise exception 'Custom agent overwritten';end if;
 if (select count(*) from knowledge_entries where business_id=b)<>1 then raise exception 'Rescan duplicated knowledge';end if;
 if (select signals from business_discovery where business_id=b)<>manual->'signals' then raise exception 'Manual classification not reflected';end if;
 -- A first scan must also respect settings and starter edits after capture.
 update businesses set dashboard_profile=profile where id=other_b;
 update ai_agents set instructions='Starter',is_active=false where id=foreign_agent;
 perform enqueue_business_discovery(other_b,other_user,'website','{"url":"https://concurrent.test"}');
 select * into j from claim_business_discovery(other_b);
 select revision into rev from business_discovery where business_id=other_b;
 update businesses set dashboard_profile=manual where id=other_b;
 update ai_agents set instructions='Changed during analysis' where id=foreign_agent;
 if not finish_context_business_discovery(j.id,j.lease_token,rev,draft,'{}',jsonb_set(knowledge,'{0,id}',to_jsonb(gen_random_uuid())),profile,'{}',jsonb_set(agent,'{id}',to_jsonb(foreign_agent))) then raise exception 'Concurrent preparation failed';end if;
 if (select dashboard_profile from businesses where id=other_b)<>manual or (select signals from business_discovery where business_id=other_b)<>manual->'signals' then raise exception 'Concurrent manual classification overwritten';end if;
 if (select instructions from ai_agents where id=foreign_agent)<>'Changed during analysis' then raise exception 'Concurrent agent edit overwritten';end if;
 if (select is_active from ai_agents where id=foreign_agent) then raise exception 'Edited inactive agent activated';end if;
 -- An edit made DURING the scan is preserved, including the stale catalog guard.
 insert into products(business_id,name,price_amount,currency) values(b,'Manual product',5,'EUR');
 perform enqueue_business_discovery(b,u,'website','{"url":"https://other.test"}');
 select * into j from claim_business_discovery(b);
 update products set price_amount=7 where business_id=b;
 select revision into rev from business_discovery where business_id=b;
 perform finish_context_business_discovery(j.id,j.lease_token,rev,draft,'{}',knowledge,profile,'{}',agent);
 if (select price_amount from products where business_id=b)<>7 then raise exception 'Catalog edit overwritten';end if;
 if (select baseline->'products'->0->>'price_amount' from business_discovery where business_id=b)::numeric<>5 then raise exception 'Unrelated catalog baseline rebased';end if;
 if has_function_privilege('authenticated','public.finish_context_business_discovery(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)','execute')
 or has_function_privilege('anon','public.context_setup_baseline(jsonb,uuid,uuid,boolean)','execute') then raise exception 'Worker function exposed';end if;
end $$;
rollback;
