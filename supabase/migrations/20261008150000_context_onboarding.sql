-- Onboarding prepares business context automatically, without applying offers.
-- Only our own writes are rebased; pending catalog edits keep their original guard.
create function public.context_setup_baseline(p_baseline jsonb,p_business uuid,p_agent uuid,p_profile_changed boolean) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb:=p_baseline; entries jsonb; b businesses;
begin
 if result is null then return null;end if;
 if p_profile_changed then
  select * into b from businesses where id=p_business;
  result:=jsonb_set(result,'{business,dashboard_profile}',coalesce(b.dashboard_profile,'null'::jsonb));
  result:=jsonb_set(result,'{business,updated_at}',to_jsonb(b.updated_at));
 end if;
 if p_agent is not null then
  select coalesce(jsonb_agg(entry order by entry->>'id'),'[]'::jsonb) into entries from (
   select entry from jsonb_array_elements(coalesce(result->'agents','[]'::jsonb)) entry where entry->>'id'<>p_agent::text
   union all select to_jsonb(a) from ai_agents a where a.id=p_agent and a.business_id=p_business
  ) items;
  result:=jsonb_set(result,'{agents}',entries);
 end if;
 return result;
end $$;

create function public.finish_context_business_discovery(p_job uuid,p_lease uuid,p_revision integer,p_draft jsonb,p_signals jsonb,p_knowledge jsonb,p_profile jsonb,p_answers jsonb,p_agent jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare j business_discovery_jobs; d business_discovery; b businesses; agent_id uuid; changed_agent uuid; profile_changed boolean:=false; prepared boolean;
begin
 select * into j from business_discovery_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from businesses where id=j.business_id for update;
 select * into d from business_discovery where business_id=j.business_id for update;
 -- The existing fenced finish handles lease, generation, revision and history.
 prepared:=finish_scanned_business_discovery(p_job,p_lease,p_revision,p_draft,p_signals,p_knowledge);
 if not prepared then return false;end if;
 select * into b from businesses where id=j.business_id;
 if coalesce(p_profile->>'version','')<>'1' or coalesce(p_profile->>'source','') not in ('generated','manual') then raise exception 'invalid_profile';end if;
 -- A settings edit made during analysis wins over the generated profile.
 if coalesce(b.dashboard_profile->>'source','')<>'manual' and coalesce(b.dashboard_profile,'null'::jsonb) is not distinct from coalesce(d.baseline->'business'->'dashboard_profile','null'::jsonb) then
  update businesses set dashboard_profile=p_profile,updated_at=now() where id=j.business_id;
  profile_changed:=true;
  update business_onboarding set answers=answers||p_answers||jsonb_build_object('name',b.name),updated_at=now()
   where business_id=j.business_id and (answers->>'onboardingMode'='sources' or coalesce(answers->>'businessType','other')='other');
 end if;
 if b.dashboard_profile->>'source'='manual' and jsonb_typeof(b.dashboard_profile->'signals')='object' then
  update business_discovery set signals=b.dashboard_profile->'signals',signals_source='manual' where business_id=j.business_id;
 end if;
 -- Reuse only an untouched starter. Never replace an existing custom agent.
 if p_agent is not null and p_agent<>'null'::jsonb and (profile_changed or coalesce(b.dashboard_profile,'null'::jsonb) is not distinct from coalesce(d.baseline->'business'->'dashboard_profile','null'::jsonb)) then
  agent_id:=(p_agent->>'id')::uuid;
  if exists(select 1 from ai_agents where id=agent_id and business_id<>j.business_id) then raise exception 'unauthorized_target';end if;
  if length(btrim(coalesce(p_agent->>'instructions','')))=0 or length(p_agent->>'instructions')>8000 then raise exception 'invalid_agent';end if;
  if not exists(select 1 from ai_agents where business_id=j.business_id and is_active) then
   if p_agent->>'expectedInstructions' is not null then
    update ai_agents set instructions=p_agent->>'instructions',is_active=true,updated_at=now()
     where id=agent_id and business_id=j.business_id and not is_active and instructions=p_agent->>'expectedInstructions'
     and exists(select 1 from jsonb_array_elements(coalesce(d.baseline->'agents','[]')) a where a->>'id'=agent_id::text and a->>'instructions'=p_agent->>'expectedInstructions' and not (a->>'is_active')::boolean);
    if found then changed_agent:=agent_id;end if;
   elsif not exists(select 1 from ai_agents where business_id=j.business_id) then
    insert into ai_agents(id,business_id,name,instructions,is_active) values(agent_id,j.business_id,'Agjenti i biznesit',p_agent->>'instructions',true);
    changed_agent:=agent_id;
   end if;
  end if;
 end if;
 update business_discovery set baseline=context_setup_baseline(baseline,j.business_id,changed_agent,profile_changed),confirmed_at=now(),updated_at=now()
  where business_id=j.business_id;
 update business_intelligence set baseline=context_setup_baseline(baseline,j.business_id,changed_agent,profile_changed) where business_id=j.business_id;
 update business_discovery_jobs set checkpoint=checkpoint||jsonb_build_object('contextPrepared',true) where id=p_job;
 -- No products, services, workflows, test certification or auto_reply writes.
 return true;
end $$;
revoke all on function public.context_setup_baseline(jsonb,uuid,uuid,boolean),public.finish_context_business_discovery(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.context_setup_baseline(jsonb,uuid,uuid,boolean),public.finish_context_business_discovery(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;

-- An information-first business can be tested and used before adding products.
alter function public.business_setup_status(uuid) rename to pre_context_business_setup_status;
create function public.business_setup_status(p_business_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare base jsonb; knowledge_count integer;
begin
 base:=pre_context_business_setup_status(p_business_id);
 select count(*) into knowledge_count from knowledge_entries where business_id=p_business_id and is_active and intent_key is distinct from 'service' and length(btrim(body))>0;
 return base||jsonb_build_object('knowledgeCount',knowledge_count);
end $$;
revoke all on function public.business_setup_status(uuid),public.pre_context_business_setup_status(uuid) from public,anon,authenticated;
grant execute on function public.business_setup_status(uuid),public.pre_context_business_setup_status(uuid) to service_role;
create or replace function public.launch_business(p_business_id uuid,p_automatic boolean) returns void
language plpgsql security invoker set search_path=public as $$
declare s jsonb;
begin
 perform id from businesses where id=p_business_id for update;if not found then raise exception 'Business missing';end if;
 s:=business_setup_status(p_business_id);
 if not(s->>'connected')::boolean or not(s->>'agentReady')::boolean or not(s->>'tested')::boolean
 or ((s->>'usableProducts')::integer=0 and (s->>'catalogCount')::integer=0 and (s->>'serviceCount')::integer=0 and ((s->>'productCount')::integer>0 or (s->>'knowledgeCount')::integer=0))
 or (s->>'unconfiguredProducts')::integer>0 then raise exception 'Setup incomplete';end if;
 update businesses set auto_reply=p_automatic where id=p_business_id;
 insert into business_setup(business_id,launched_at,launch_mode) values(p_business_id,now(),case when p_automatic then 'automatic' else 'manual' end)
 on conflict(business_id) do update set launched_at=excluded.launched_at,launch_mode=excluded.launch_mode;
end $$;
