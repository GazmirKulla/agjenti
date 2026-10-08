begin;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000601','process-owner@example.test'),('00000000-0000-4000-8000-000000000602','process-other@example.test');
do $$
declare u uuid:='00000000-0000-4000-8000-000000000601'; outsider uuid:='00000000-0000-4000-8000-000000000602'; b uuid; c instagram_connections; j business_discovery_jobs; rev integer; sig text;
 empty_draft jsonb:='{"entities":[],"conflicts":[],"missingInformation":[],"suggestedClarifications":[]}';
 profile jsonb:='{"version":1,"source":"generated","signals":{"businessType":"ecommerce"},"enabledModules":["knowledge","workflows"]}';
 process jsonb:='{"version":1,"source":"generated","enabled":true,"name":"Materialet PDF","summary":"Shkarkim nga website-i","steps":[{"key":"business_step_1","title":"Shkarko PDF","description":"Materialet shkarkohen nga website-i","evidence":"Shkarko tani PDF","sourceRef":"instagram:studio"}],"unknowns":["Pagesa nuk është përshkruar."]}';
 manual jsonb; metadata jsonb:='{"name":"Studio","biography":"Fletë pune edukative","website":"https://studio.test","access_token":"SHOULD_NOT_BE_SAVED"}';
begin
 perform complete_business_onboarding(u,'{"name":"Studio","useCases":[],"onboardingMode":"sources"}','Starter');
 select business_id into b from business_users where user_id=u;
 insert into instagram_connections(business_id,ig_user_id,access_token_ciphertext) values(b,'process-instagram','unused') returning * into c;
 perform enqueue_business_discovery(b,u,'instagram',jsonb_build_object('connectionId',c.id,'generation',c.discovery_generation));
 select * into j from claim_business_discovery(b);
 select revision into rev from business_discovery where business_id=b;
 if finish_discovery_with_process(j.id,gen_random_uuid(),rev,empty_draft,'{}','[]',profile,'{}',null,process,0,metadata,'[]') then raise exception 'Wrong lease saved process';end if;
 if not finish_discovery_with_process(j.id,j.lease_token,rev,empty_draft,'{}','[]',profile,'{}',null,process,0,metadata,'[]') then raise exception 'Journey not saved';end if;
 if (select operating_workflow from business_discovery where business_id=b) is distinct from process then raise exception 'Journey missing';end if;
 if (select source_profile->>'website' from business_discovery where business_id=b)<>'https://studio.test' then raise exception 'Website missing';end if;
 if (select source_profile ? 'access_token' from business_discovery where business_id=b) then raise exception 'Provider payload leaked';end if;
 if exists(select 1 from products where business_id=b) or exists(select 1 from workflows where business_id=b) then raise exception 'Descriptive journey became product execution';end if;
 sig:=business_setup_status(b)->>'signature';
 manual:=jsonb_set(jsonb_set(process,'{source}','"manual"'),'{enabled}','false');
 begin
  perform save_business_process(b,outsider,1,manual);
  raise exception 'Foreign user edited journey' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'unauthorized' then raise;end if;end;
 if save_business_process(b,u,1,manual)<>2 then raise exception 'Revision not advanced';end if;
 if business_setup_status(b)->>'signature'=sig then raise exception 'Process edit did not invalidate test';end if;
 begin
  perform save_business_process(b,u,1,manual);
  raise exception 'Stale edit accepted' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'stale_process' then raise;end if;end;
 -- Manual changes made during a rescan remain authoritative while context finishes.
 perform enqueue_business_discovery(b,u,'website','{"url":"https://studio.test"}');
 select * into j from claim_business_discovery(b);
 select revision into rev from business_discovery where business_id=b;
 manual:=jsonb_set(manual,'{summary}','"Procesi im i përshtatur"');
 perform save_business_process(b,u,2,manual);
 if not finish_discovery_with_process(j.id,j.lease_token,rev,empty_draft,'{}','[]',profile,'{}',null,process,2,null,'[]') then raise exception 'Rescan blocked by manual process';end if;
 if (select operating_workflow from business_discovery where business_id=b) is distinct from manual then raise exception 'Manual process overwritten';end if;
 if (select source_profile->>'website' from business_discovery where business_id=b)<>'https://studio.test' then raise exception 'Website scan cleared profile';end if;
 -- Invalid generated processes roll back even the completion checkpoint.
 perform enqueue_business_discovery(b,u,'website','{"url":"https://studio.test"}',true);
 select * into j from claim_business_discovery(b);
 select revision into rev from business_discovery where business_id=b;
 begin
  perform finish_discovery_with_process(j.id,j.lease_token,rev,empty_draft,'{}','[]',profile,'{}',null,jsonb_set(process,'{steps}','[]'),3,null,'[]');
  raise exception 'Invalid process accepted' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'invalid_process' then raise;end if;end;
 if (select status from business_discovery_jobs where id=j.id)<>'running' then raise exception 'Invalid process committed partial setup';end if;
 if has_function_privilege('authenticated','public.save_business_process(uuid,uuid,integer,jsonb)','execute') then raise exception 'Process mutation exposed';end if;
end $$;
rollback;
