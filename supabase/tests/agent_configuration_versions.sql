-- Synthetic fixtures, rolled back. Runs only against a local database (socket or loopback).
begin;
-- Each direct write below stands for its own request: its deferred version trigger runs as at that request's commit.
do $$ begin if inet_server_addr() is not null and host(inet_server_addr()) not in ('127.0.0.1','::1') then raise exception 'local database required'; end if; end $$;
do $$
declare b uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); svc uuid:=gen_random_uuid(); k1 uuid:=gen_random_uuid(); k2 uuid:=gen_random_uuid(); k_off uuid:=gen_random_uuid();
 k_other uuid:=gen_random_uuid(); k_new uuid:=gen_random_uuid(); booking uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
 r jsonb; base bigint; v bigint; failed text; booking_row jsonb; k1_stamp timestamptz; agent_stamp timestamptz; svc_stamp timestamptz; job uuid:=gen_random_uuid(); proposed uuid:=gen_random_uuid();
begin
 insert into auth.users(id) values(u),(outsider);
 insert into public.businesses(id,name,slug) values(b,'Config test',b::text),(other,'Other',other::text);
 insert into public.business_users(business_id,user_id,role) values(b,u,'owner'),(other,outsider,'owner');
 insert into public.ai_agents(id,business_id,name,instructions,is_active) values(a,b,'Agent','Original instructions',true);
 insert into public.booking_services(id,business_id,name,booking_enabled,price_amount) values(svc,b,'Konsulta',true,1500);
 insert into public.knowledge_entries(id,business_id,title,body,is_active) values(k1,b,'Dërgesa','Brenda 24 orësh',true),(k_off,b,'E fikur','Nuk përdoret',false),(k_other,other,'Tjetër','Biznes tjetër',true);
 insert into public.bookings(id,business_id,service_id,customer_name,status) values(booking,b,svc,'Klient','confirmed');
 select to_jsonb(x) into booking_row from public.bookings x where id=booking;
 execute 'set constraints all immediate'; execute 'set constraints all deferred'; perform set_config('agjenti.configuration_seen_'||replace(b::text,'-',''),'',true);
 select coalesce(max(revision),0) into base from public.agent_configuration_snapshots where business_id=b;
 if base<1 then raise exception 'direct fixture writes must have recorded versions'; end if;
 select updated_at into agent_stamp from public.ai_agents where id=a;
 select updated_at into svc_stamp from public.booking_services where id=svc;
 select updated_at into k1_stamp from public.knowledge_entries where id=k1;

 -- One confirmation, several parts: the service becomes information-only and the instructions say who books.
 r:=public.apply_agent_configuration(b,u,req,base,jsonb_build_array(
  jsonb_build_object('type','service.booking','id',svc,'booking_enabled',false,'expected',svc_stamp),
  jsonb_build_object('type','agent.update','id',a,'instructions','Original instructions\nPër Konsultën jep vetëm informacion; rezervimin e merr stafi.','expected',agent_stamp),
  jsonb_build_object('type','knowledge.save','id',k_new,'title','Konsulta','body','Rezervimin e cakton stafi.')),'assistant','Konsulta vetëm informacion');
 if not (r->>'created')::boolean or (r->>'revision')::bigint<>base+1 then raise exception 'multi-part change did not create one version: %',r; end if;
 if (select booking_enabled from public.booking_services where id=svc) then raise exception 'service permission not applied'; end if;
 if (select instructions from public.ai_agents where id=a) not like '%stafi.' then raise exception 'instructions not applied'; end if;
 if not exists(select 1 from public.knowledge_entries where id=k_new and is_active) then raise exception 'knowledge not applied'; end if;
 if (select to_jsonb(x) from public.bookings x where id=booking)<>booking_row then raise exception 'existing booking changed'; end if;
 base:=base+1;

 -- A repeated request after a timeout returns the first result and writes nothing more.
 r:=public.apply_agent_configuration(b,u,req,base-1,jsonb_build_array(
  jsonb_build_object('type','service.booking','id',svc,'booking_enabled',false,'expected',svc_stamp),
  jsonb_build_object('type','agent.update','id',a,'instructions','Original instructions\nPër Konsultën jep vetëm informacion; rezervimin e merr stafi.','expected',agent_stamp),
  jsonb_build_object('type','knowledge.save','id',k_new,'title','Konsulta','body','Rezervimin e cakton stafi.')),'assistant','Konsulta vetëm informacion');
 if not (r->>'replayed')::boolean or (select count(*) from public.agent_configuration_snapshots where business_id=b and revision>base) > 0 then raise exception 'retry duplicated the change'; end if;
 failed:=null;
 begin perform public.apply_agent_configuration(b,u,req,base,'[{"type":"behavior.set","voice":false}]','owner',''); exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'configuration_request_conflict' then raise exception 'reused request id with other changes accepted: %',failed; end if;

 -- A failure in the middle leaves nothing applied and no version.
 failed:=null;
 begin perform public.apply_agent_configuration(b,u,gen_random_uuid(),base,jsonb_build_array(
  jsonb_build_object('type','knowledge.active','id',k1,'is_active',false),
  jsonb_build_object('type','agent.update','id',a,'communication',jsonb_build_object('version',1,'tone','loud'))),'owner','');
 exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'invalid_configuration_change' or not (select is_active from public.knowledge_entries where id=k1)
  or (select max(revision) from public.agent_configuration_snapshots where business_id=b)<>base then raise exception 'partial write after failure: %',failed; end if;

 -- A proposal prepared on an older version, or an object changed meanwhile, is not applied.
 failed:=null;
 begin perform public.apply_agent_configuration(b,u,gen_random_uuid(),base-1,'[{"type":"behavior.set","voice":false}]','owner',''); exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'stale_configuration' then raise exception 'stale base accepted: %',failed; end if;
 failed:=null;
 begin perform public.apply_agent_configuration(b,u,gen_random_uuid(),null,jsonb_build_array(jsonb_build_object('type','knowledge.save','id',k1,'title','X','body','Y','expected',k1_stamp-interval '1 second')),'owner','');
 exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'stale_configuration_target' then raise exception 'stale object accepted: %',failed; end if;

 -- Another business's objects and people never pass.
 failed:=null;
 begin perform public.apply_agent_configuration(b,u,gen_random_uuid(),null,jsonb_build_array(jsonb_build_object('type','knowledge.active','id',k_other,'is_active',false)),'owner','');
 exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'configuration_target_missing' or not (select is_active from public.knowledge_entries where id=k_other) then raise exception 'cross-business write: %',failed; end if;
 failed:=null;
 begin perform public.apply_agent_configuration(b,outsider,gen_random_uuid(),null,'[{"type":"behavior.set","voice":false}]','owner',''); exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'unauthorized' then raise exception 'outsider accepted: %',failed; end if;

 -- Saving without a change creates no version.
 r:=public.apply_agent_configuration(b,u,gen_random_uuid(),base,jsonb_build_array(jsonb_build_object('type','service.booking','id',svc,'booking_enabled',false)),'owner','');
 if (r->>'created')::boolean or (r->>'revision')::bigint<>base then raise exception 'no-op save created a version'; end if;

 -- Only three versions stay restorable; the audit keeps every line.
 for v in 1..4 loop
  perform public.apply_agent_configuration(b,u,gen_random_uuid(),null,jsonb_build_array(jsonb_build_object('type','knowledge.save','id',k1,'title','Dërgesa','body','Version '||v)),'owner','v'||v);
 end loop;
 select max(revision) into base from public.agent_configuration_snapshots where business_id=b;
 if (select count(*) from public.agent_configuration_snapshots where business_id=b)<>3 then raise exception 'more than three restorable versions'; end if;
 if (select count(*) from public.agent_configuration_audit where business_id=b)<base then raise exception 'audit lines lost'; end if;
 failed:=null;
 begin perform public.revert_agent_configuration(b,u,gen_random_uuid(),base,base-3); exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'configuration_version_missing' then raise exception 'dropped version restored: %',failed; end if;

 -- Bringing an earlier version back: knowledge text and state together, as a new version; later entries are switched off, not deleted.
 insert into public.knowledge_entries(id,business_id,title,body,is_active) values(k2,b,'E re','Shtuar pas',true);
 execute 'set constraints all immediate'; execute 'set constraints all deferred'; perform set_config('agjenti.configuration_seen_'||replace(b::text,'-',''),'',true);
 select max(revision) into base from public.agent_configuration_snapshots where business_id=b;
 r:=public.revert_agent_configuration(b,u,gen_random_uuid(),base,base-2);
 if (r->>'revision')::bigint<>base+1 then raise exception 'revert did not create a new version: %',r; end if;
 if (select body from public.knowledge_entries where id=k1)<>'Version 3' then raise exception 'knowledge text not restored: %',(select body from public.knowledge_entries where id=k1); end if;
 if not exists(select 1 from public.knowledge_entries where id=k2 and not is_active) then raise exception 'later entry not switched off'; end if;
 if (select is_active from public.knowledge_entries where id=k_off) then raise exception 'inactive knowledge activated by revert'; end if;
 if (select to_jsonb(x) from public.bookings x where id=booking)<>booking_row then raise exception 'revert changed a booking'; end if;

 -- A version naming an object that is gone is not restored at all.
 select max(revision) into base from public.agent_configuration_snapshots where business_id=b;
 delete from public.bookings where id=booking;
 delete from public.booking_services where id=svc;
 execute 'set constraints all immediate'; execute 'set constraints all deferred'; perform set_config('agjenti.configuration_seen_'||replace(b::text,'-',''),'',true);
 select max(revision) into base from public.agent_configuration_snapshots where business_id=b;
 failed:=null;
 begin perform public.revert_agent_configuration(b,u,gen_random_uuid(),base,base-1); exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'configuration_target_missing' or (select max(revision) from public.agent_configuration_snapshots where business_id=b)<>base then raise exception 'partial revert: %',failed; end if;

 -- Provenance metadata (a page check) is not a configuration change.
 select max(revision) into v from public.agent_configuration_snapshots where business_id=b;
 update public.knowledge_entries set source=jsonb_build_object('kind','website','notFoundAt',now()) where id=k1;
 execute 'set constraints all immediate'; execute 'set constraints all deferred'; perform set_config('agjenti.configuration_seen_'||replace(b::text,'-',''),'',true);
 if (select max(revision) from public.agent_configuration_snapshots where business_id=b)<>v then raise exception 'metadata made a version'; end if;
 -- A writer outside the mechanism (e.g. the service or calendar form, onboarding) is versioned in its own transaction.
 update public.knowledge_entries set body='Ndryshuar nga një formular tjetër' where id=k1;
 execute 'set constraints all immediate'; execute 'set constraints all deferred'; perform set_config('agjenti.configuration_seen_'||replace(b::text,'-',''),'',true);
 if (select max(revision) from public.agent_configuration_snapshots where business_id=b)<>v+1 then raise exception 'direct write not versioned'; end if;
 -- A source proposal is not configuration until decided; the decision is kept and checks the reviewed content.
 insert into public.knowledge_entries(id,business_id,title,body,is_active) values(proposed,b,'Orari','09–17',false);
 insert into public.business_discovery_jobs(id,business_id,source,status,checkpoint) values(job,b,'website','completed',jsonb_build_object('review',jsonb_build_object('status','pending','knowledgeIds',jsonb_build_array(proposed::text))));
 select max(revision) into v from public.agent_configuration_snapshots where business_id=b;
 execute 'set constraints all immediate'; execute 'set constraints all deferred'; perform set_config('agjenti.configuration_seen_'||replace(b::text,'-',''),'',true);
 if (select max(revision) from public.agent_configuration_snapshots where business_id=b)<>v then raise exception 'a pending proposal made a version'; end if;
 if exists(select 1 from jsonb_array_elements((select snapshot from public.agent_configuration_snapshots where business_id=b order by revision desc limit 1)->'knowledge') x where x->>'id'=proposed::text)
  then raise exception 'undecided proposal counted as configuration'; end if;
 failed:=null;
 begin perform public.apply_agent_configuration(b,u,gen_random_uuid(),null,jsonb_build_array(jsonb_build_object('type','proposal.decide','id',proposed,'decision','accept','expected',now()-interval '1 day')),'sources','');
 exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'stale_configuration_target' then raise exception 'changed proposal accepted: %',failed; end if;
 perform public.apply_agent_configuration(b,u,gen_random_uuid(),null,jsonb_build_array(jsonb_build_object('type','proposal.decide','id',proposed,'decision','accept',
  'expected',(select updated_at from public.knowledge_entries where id=proposed))),'sources','Orari nga faqja');
 if not (select is_active from public.knowledge_entries where id=proposed)
  or (select checkpoint->'review'->'knowledgeIds' from public.business_discovery_jobs where id=job)<>'[]'::jsonb
  or (select checkpoint->'review'->'decisions'->proposed::text->>'decision' from public.business_discovery_jobs where id=job)<>'accept' then raise exception 'proposal decision not kept'; end if;
 -- Accepted, then switched off: still configuration, never a pending proposal again.
 perform public.apply_agent_configuration(b,u,gen_random_uuid(),null,jsonb_build_array(jsonb_build_object('type','knowledge.active','id',proposed,'is_active',false)),'owner','');
 if not exists(select 1 from jsonb_array_elements((select snapshot from public.agent_configuration_snapshots where business_id=b order by revision desc limit 1)->'knowledge') x where x->>'id'=proposed::text and x->>'is_active'='false')
  then raise exception 'switched-off accepted entry missing from configuration'; end if;
 raise notice 'agent configuration versions: all checks passed';
end $$;
rollback;
