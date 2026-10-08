-- Apply after 20261008160000_business_process.sql. Safe to run again in SQL Editor.
-- Keep generated agent ownership explicit; never auto-update a manually edited agent.
do $$ begin
 if to_regprocedure('public.valid_business_process(jsonb)') is null then
  raise exception 'Apply 20261008160000_business_process.sql before 20261008170000_onboarding_preparation.sql';
 end if;
end $$;
alter table public.business_discovery add column if not exists generated_agent jsonb;

create or replace function public.valid_business_process(p jsonb) returns boolean
language plpgsql immutable set search_path=public as $$
declare step jsonb; item jsonb;
begin
 if coalesce(p->>'version','')<>'1' or coalesce(p->>'source','') not in ('manual','generated') or jsonb_typeof(p->'enabled') is distinct from 'boolean'
 or length(btrim(coalesce(p->>'name','')))=0 or length(p->>'name')>120 or length(btrim(coalesce(p->>'summary','')))=0 or length(p->>'summary')>1000
 or jsonb_typeof(p->'steps') is distinct from 'array' or jsonb_typeof(p->'unknowns') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p->'steps') not between 1 and 8 or jsonb_array_length(p->'unknowns')>6 then return false;end if;
 for step in select * from jsonb_array_elements(p->'steps') loop
  if length(btrim(coalesce(step->>'title','')))=0 or length(step->>'title')>100 or length(btrim(coalesce(step->>'description','')))=0 or length(step->>'description')>1000
   or (p->>'source'='generated' and (length(btrim(coalesce(step->>'evidence','')))=0 or length(btrim(coalesce(step->>'sourceRef','')))=0))
   or length(coalesce(step->>'evidence',''))>2000 or length(coalesce(step->>'sourceRef',''))>2000 then return false;end if;
 end loop;
 for item in select * from jsonb_array_elements(p->'unknowns') loop
  if jsonb_typeof(item)<>'string' or length(item#>>'{}')>300 then return false;end if;
 end loop;
 if p ? 'publishedSteps' then
  if jsonb_typeof(p->'publishedSteps') is distinct from 'array' or jsonb_array_length(p->'publishedSteps')>8 then return false;end if;
  if jsonb_array_length(p->'publishedSteps')>0 and not valid_business_process((p-'publishedSteps')||jsonb_build_object('steps',p->'publishedSteps')) then return false;end if;
 end if;
 return true;
end $$;

revoke all on function public.valid_business_process(jsonb) from public,anon,authenticated;
grant execute on function public.valid_business_process(jsonb) to service_role;

create or replace function public.finish_discovery_with_process(p_job uuid,p_lease uuid,p_revision integer,p_draft jsonb,p_signals jsonb,p_knowledge jsonb,p_profile jsonb,p_answers jsonb,p_agent jsonb,p_process jsonb,p_process_revision integer,p_source_profile jsonb,p_warnings jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare j business_discovery_jobs; d business_discovery; prepared boolean; b businesses; agent_id uuid; generated boolean:=false; changed_agent uuid;
begin
 select * into j from business_discovery_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from businesses where id=j.business_id for update;
 select * into d from business_discovery where business_id=j.business_id for update;
 select * into b from businesses where id=j.business_id;
 prepared:=finish_context_business_discovery(p_job,p_lease,p_revision,p_draft,p_signals,p_knowledge,p_profile,p_answers,p_agent);
 if not prepared then return false;end if;
 -- Enrich only an agent we generated earlier and whose exact instructions remain
 -- untouched. User edits and additional active agents win over automatic setup.
 if p_agent is not null and p_agent<>'null'::jsonb and
    coalesce(b.dashboard_profile,'null'::jsonb) is not distinct from coalesce(d.baseline->'business'->'dashboard_profile','null'::jsonb) then
  agent_id:=(p_agent->>'id')::uuid;
  if d.generated_agent->>'id'=agent_id::text and d.generated_agent->>'instructions'=p_agent->>'expectedInstructions' then
   if length(btrim(coalesce(p_agent->>'instructions','')))=0 or length(p_agent->>'instructions')>8000 then raise exception 'invalid_agent';end if;
   update ai_agents set instructions=p_agent->>'instructions',updated_at=now()
    where id=agent_id and business_id=j.business_id and is_active and instructions=d.generated_agent->>'instructions'
    and not exists(select 1 from ai_agents where business_id=j.business_id and is_active and id<>agent_id);
   if found then changed_agent:=agent_id;generated:=true;end if;
  elsif not exists(select 1 from jsonb_array_elements(coalesce(d.baseline->'agents','[]')) old where (old->>'is_active')::boolean)
   and exists(select 1 from ai_agents where id=agent_id and business_id=j.business_id and is_active and instructions=p_agent->>'instructions') then
   -- The fenced context finish just activated/created the untouched starter.
   generated:=true;
  end if;
  if generated then
   update business_discovery set generated_agent=jsonb_build_object('id',agent_id,'instructions',p_agent->>'instructions'),
    baseline=context_setup_baseline(baseline,j.business_id,changed_agent,false) where business_id=j.business_id;
   update business_intelligence set baseline=context_setup_baseline(baseline,j.business_id,changed_agent,false) where business_id=j.business_id;
  end if;
 end if;

 if p_process is not null and p_process<>'null'::jsonb then
  if not valid_business_process(p_process) or p_process->>'source'<>'generated' then raise exception 'invalid_process';end if;
  if d.process_revision=p_process_revision and coalesce(d.operating_workflow->>'source','generated')<>'manual' then
   update business_discovery set operating_workflow=p_process,process_revision=process_revision+1 where business_id=j.business_id;
  end if;
 end if;
 if j.source='instagram' and jsonb_typeof(p_source_profile)='object' then
  -- Persist only supported public metadata, never arbitrary provider payloads.
  update business_discovery set source_profile=jsonb_strip_nulls(jsonb_build_object(
   'connectionId',j.input->>'connectionId','generation',j.input->>'generation',
   'name',left(p_source_profile->>'name',2000),'username',left(p_source_profile->>'username',2000),'biography',left(p_source_profile->>'biography',2000),
   'website',left(p_source_profile->>'website',2000),'profile_picture_url',left(p_source_profile->>'profile_picture_url',2000))) where business_id=j.business_id;
 end if;
 if jsonb_typeof(p_warnings) is distinct from 'array' or jsonb_array_length(p_warnings)>20 then raise exception 'invalid_warnings';end if;
 update business_discovery_jobs set checkpoint=checkpoint||jsonb_build_object('warnings',p_warnings,'businessProcessPrepared',p_process is not null and p_process<>'null'::jsonb,'agentPrepared',generated) where id=p_job;
 return true;
end $$;

revoke all on function public.finish_discovery_with_process(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_discovery_with_process(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,integer,jsonb,jsonb) to service_role;
