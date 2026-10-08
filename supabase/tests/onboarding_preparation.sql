begin;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000701','preparation-owner@example.test');
do $$
declare u uuid:='00000000-0000-4000-8000-000000000701'; b uuid; a ai_agents; j business_discovery_jobs; rev integer; marker jsonb;
 draft jsonb:='{"entities":[],"conflicts":[],"missingInformation":[],"suggestedClarifications":[]}';
 profile jsonb:='{"version":1,"source":"generated","signals":{"businessType":"services"},"enabledModules":["knowledge","workflows"]}';
 journey jsonb:='{"version":1,"source":"generated","basis":"onboarding","enabled":true,"name":"Kërkesa për shërbim","summary":"Pikënisje nga onboarding-u","steps":[{"title":"Sqaro kërkesën","description":"Kupto shërbimin që kërkohet","evidence":"Kupto shërbimin që kërkohet","sourceRef":"onboarding:service-request"}],"unknowns":[]}';
 agent jsonb; knowledge jsonb;
begin
 perform complete_business_onboarding(u,'{"name":"Studio","useCases":[],"onboardingMode":"sources"}','Starter');
 select business_id into b from business_users where user_id=u;
 select * into a from ai_agents where business_id=b;
 agent:=jsonb_build_object('id',a.id,'expectedInstructions',a.instructions,'instructions','First generated instructions');
 select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'target','knowledge','facts',jsonb_build_array(
  jsonb_build_object('field','title','value',topic,'source','website','evidence',topic),
  jsonb_build_object('field','body','value',topic||' supported details','source','website','evidence',topic||' supported details')))) into knowledge
 from unnest(array['Oferta','Audienca','Përfitimet','Përdorimi']) topic;
 perform enqueue_business_discovery(b,u,'website','{"url":"https://studio.test"}');
 select * into j from claim_business_discovery(b);
 select revision into rev from business_discovery where business_id=b;
 if finish_discovery_with_process(j.id,gen_random_uuid(),rev,draft,'{}',knowledge,profile,'{}',agent,journey,0,null,'[]') then raise exception 'Wrong lease accepted';end if;
 if not finish_discovery_with_process(j.id,j.lease_token,rev,draft,'{}',knowledge,profile,'{}',agent,journey,0,null,'[]') then raise exception 'Preparation failed';end if;
 select generated_agent into marker from business_discovery where business_id=b;
 if marker->>'id'<>a.id::text or marker->>'instructions'<>'First generated instructions' then raise exception 'Generated ownership not recorded';end if;
 if (select count(*) from knowledge_entries where business_id=b and is_active)<>4 then raise exception 'Independent topics missing';end if;
 if (select operating_workflow->>'basis' from business_discovery where business_id=b)<>'onboarding' then raise exception 'Workflow starter missing';end if;
 if not valid_business_process(journey||jsonb_build_object('publishedSteps',journey->'steps')) then raise exception 'Supported published process rejected';end if;
 if valid_business_process(journey||'{"publishedSteps":[{}]}'::jsonb) then raise exception 'Invalid published steps accepted';end if;
 if exists(select 1 from products where business_id=b) then raise exception 'Onboarding created offers';end if;
 -- A second source enriches the same generated agent; it does not create another.
 perform enqueue_business_discovery(b,u,'website','{"url":"https://studio.test/about"}');
 select * into j from claim_business_discovery(b);
 select revision into rev from business_discovery where business_id=b;
 agent:=jsonb_build_object('id',a.id,'expectedInstructions','First generated instructions','instructions','Enriched instructions');
 if not finish_discovery_with_process(j.id,j.lease_token,rev,draft,'{}','[]',profile,'{}',agent,journey,1,null,'[]') then raise exception 'Enrichment failed';end if;
 if (select instructions from ai_agents where id=a.id)<>'Enriched instructions' then raise exception 'Generated agent not enriched';end if;
 if (select count(*) from ai_agents where business_id=b)<>1 then raise exception 'Duplicate generated agent';end if;
 if not exists(select 1 from business_discovery d,jsonb_array_elements(d.baseline->'agents') old where d.business_id=b and old->>'id'=a.id::text and old->>'instructions'='Enriched instructions') then raise exception 'Own agent writes not rebased';end if;
 -- An edit while a scan is running wins, even when its baseline is older.
 perform enqueue_business_discovery(b,u,'website','{"url":"https://studio.test/faq"}');
 select * into j from claim_business_discovery(b);
 select revision into rev from business_discovery where business_id=b;
 update ai_agents set instructions='Manual correction' where id=a.id;
 agent:=jsonb_build_object('id',a.id,'expectedInstructions','Enriched instructions','instructions','New scan instructions');
 if not finish_discovery_with_process(j.id,j.lease_token,rev,draft,'{}','[]',profile,'{}',agent,journey,2,null,'[]') then raise exception 'Manual correction blocked context';end if;
 if (select instructions from ai_agents where id=a.id)<>'Manual correction' then raise exception 'Manual correction overwritten';end if;
 if (select generated_agent->>'instructions' from business_discovery where business_id=b)<>'Enriched instructions' then raise exception 'Manual agent claimed as generated';end if;
 if (select count(*) from knowledge_entries where business_id=b and is_active)<>4 then raise exception 'Rescan removed knowledge';end if;
 if has_function_privilege('authenticated','public.finish_discovery_with_process(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,integer,jsonb,jsonb)','execute') then raise exception 'Preparation worker exposed';end if;
end $$;
rollback;
