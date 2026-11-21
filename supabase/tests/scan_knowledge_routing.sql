begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000501','scan-owner@example.test'),
 ('00000000-0000-4000-8000-000000000502','scan-other@example.test');
do $$
declare u uuid:='00000000-0000-4000-8000-000000000501'; other_u uuid:='00000000-0000-4000-8000-000000000502';
 b uuid; other_b uuid; faq jsonb; draft jsonb; result jsonb; rev integer; j business_discovery_jobs; count_before integer; foreign_id uuid:=gen_random_uuid();
begin
 perform complete_business_onboarding(u,'{"name":"Scan Studio","useCases":[],"onboardingMode":"sources"}','Starter');
 perform complete_business_onboarding(other_u,'{"name":"Other Studio","useCases":[]}','Starter');
 select business_id into b from business_users where user_id=u;
 select business_id into other_b from business_users where user_id=other_u;
 faq:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'target','knowledge','facts',jsonb_build_array(
  jsonb_build_object('field','title','value','Dërgesa','source','website','evidence','Dërgesa'),
  jsonb_build_object('field','body','value','Brenda dy ditësh.','source','website','evidence','Brenda dy ditësh.'))));
 draft:='{"entities":[],"conflicts":[],"missingInformation":[],"suggestedClarifications":[]}';
 -- Source-backed FAQ goes straight to Knowledge, active.
 result:=route_scan_knowledge(b,faq);
 if result->>'count'<>'1' then raise exception 'FAQ not routed';end if;
 if not exists(select 1 from knowledge_entries where business_id=b and title='Dërgesa' and body='Brenda dy ditësh.' and is_active) then raise exception 'FAQ not active in Knowledge';end if;
 -- Products can still be confirmed after the automatic Knowledge insert.
 select revision into rev from business_intelligence where business_id=b;
 update business_intelligence set data=draft, baseline=intelligence_snapshot(b) where business_id=b;
 perform apply_intelligence(b,u,rev,draft,jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'target','product','facts',jsonb_build_array(jsonb_build_object('field','name','value','Puzzle'),jsonb_build_object('field','price','value','12'),jsonb_build_object('field','currency','value','EUR')))));
 -- A replay does not duplicate the answer.
 select count(*) into count_before from knowledge_entries where business_id=b;
 perform route_scan_knowledge(b,faq);
 if (select count(*) from knowledge_entries where business_id=b)<>count_before then raise exception 'Replay duplicated FAQ';end if;
 -- A competing answer is kept inactive, preserving the existing answer.
 faq:=jsonb_set(faq,'{0,id}',to_jsonb(gen_random_uuid()::text));
 faq:=jsonb_set(faq,'{0,facts,1,value}','"Brenda tri ditësh."');
 faq:=jsonb_set(faq,'{0,facts,1,evidence}','"Brenda tri ditësh."');
 result:=route_scan_knowledge(b,faq);
 if result->>'inactiveCount'<>'1' or not exists(select 1 from knowledge_entries where business_id=b and body='Brenda tri ditësh.' and not is_active) then raise exception 'Competing FAQ overwrote active answer';end if;
 -- Service-only writes and tenant fencing.
 if has_function_privilege('authenticated','public.route_scan_knowledge(uuid,jsonb)','EXECUTE') then raise exception 'Direct client scan write permitted';end if;
 insert into knowledge_entries(id,business_id,title,body) values(foreign_id,other_b,'Foreign','Do not touch');
 faq:=jsonb_set(faq,'{0,id}',to_jsonb(foreign_id::text));
 begin
  perform route_scan_knowledge(b,faq);
  raise exception 'Foreign entry overwritten' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'unauthorized_target' then raise;end if;end;
 if (select title from knowledge_entries where id=foreign_id)<>'Foreign' then raise exception 'Foreign entry changed';end if;
 -- Discovery finish uses the same atomic routing and lease/revision fencing.
 perform enqueue_business_discovery(b,u,'website','{"url":"https://shop.test"}');
 select * into j from claim_business_discovery(b);
 select revision into rev from business_discovery where business_id=b;
 faq:=jsonb_set(faq,'{0,id}',to_jsonb(gen_random_uuid()::text));
 faq:=jsonb_set(faq,'{0,facts,0,value}','"Kthimet"');
 if finish_scanned_business_discovery(j.id,gen_random_uuid(),rev,draft,'{}',faq) then raise exception 'Wrong lease imported FAQ';end if;
 if exists(select 1 from knowledge_entries where business_id=b and title='Kthimet') then raise exception 'Wrong lease changed knowledge';end if;
 if not finish_scanned_business_discovery(j.id,j.lease_token,rev,draft,'{}',faq) then raise exception 'Discovery routing failed';end if;
 if (select checkpoint->>'knowledgeCount' from business_discovery_jobs where id=j.id)<>'1' then raise exception 'Routing summary missing';end if;
 if (select baseline from business_discovery where business_id=b) is distinct from intelligence_snapshot(b) then raise exception 'Discovery own FAQ caused baseline conflict';end if;
 -- The functions only the removed "Plotëso me AI" dialog used are gone.
 if to_regprocedure('public.save_scanned_intelligence(uuid,uuid,integer,jsonb,jsonb,jsonb)') is not null
  or to_regprocedure('public.save_intelligence_draft(uuid,integer,jsonb,jsonb)') is not null
  or to_regprocedure('public.claim_intelligence_source(uuid,uuid,text)') is not null then raise exception 'Dialog-only functions still exist';end if;
end $$;
rollback;
