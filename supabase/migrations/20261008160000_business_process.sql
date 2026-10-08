-- A descriptive customer journey is separate from executable product workflows.
create function public.valid_business_process(p jsonb) returns boolean
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
 return true;
end $$;
alter table public.business_discovery add column source_profile jsonb,
 add column operating_workflow jsonb check(operating_workflow is null or public.valid_business_process(operating_workflow)),
 add column process_revision integer not null default 0;

create function public.finish_discovery_with_process(p_job uuid,p_lease uuid,p_revision integer,p_draft jsonb,p_signals jsonb,p_knowledge jsonb,p_profile jsonb,p_answers jsonb,p_agent jsonb,p_process jsonb,p_process_revision integer,p_source_profile jsonb,p_warnings jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare j business_discovery_jobs; d business_discovery; prepared boolean;
begin
 select * into j from business_discovery_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from businesses where id=j.business_id for update;
 select * into d from business_discovery where business_id=j.business_id for update;
 prepared:=finish_context_business_discovery(p_job,p_lease,p_revision,p_draft,p_signals,p_knowledge,p_profile,p_answers,p_agent);
 if not prepared then return false;end if;
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
 update business_discovery_jobs set checkpoint=checkpoint||jsonb_build_object('warnings',p_warnings,'businessProcessPrepared',p_process is not null and p_process<>'null'::jsonb) where id=p_job;
 return true;
end $$;

create function public.save_business_process(p_business uuid,p_user uuid,p_revision integer,p_process jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare next_revision integer;
begin
 perform 1 from businesses where id=p_business for update;
 if not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized';end if;
 if not valid_business_process(p_process) or p_process->>'source'<>'manual' then raise exception 'invalid_process';end if;
 insert into business_discovery(business_id,baseline) values(p_business,intelligence_snapshot(p_business)) on conflict do nothing;
 update business_discovery set operating_workflow=p_process,process_revision=process_revision+1,updated_at=now() where business_id=p_business and process_revision=p_revision returning process_revision into next_revision;
 if not found then raise exception 'stale_process';end if;
 return next_revision;
end $$;
revoke all on function public.valid_business_process(jsonb),public.finish_discovery_with_process(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,integer,jsonb,jsonb),public.save_business_process(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.valid_business_process(jsonb),public.finish_discovery_with_process(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,integer,jsonb,jsonb),public.save_business_process(uuid,uuid,integer,jsonb) to service_role;

-- Changing/turning off the journey invalidates earlier agent test certification.
alter function public.business_setup_status(uuid) rename to pre_process_business_setup_status;
create function public.business_setup_status(p_business_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare base jsonb; process jsonb; signature text;
begin
 base:=pre_process_business_setup_status(p_business_id);
 select operating_workflow into process from business_discovery where business_id=p_business_id;
 signature:=case when process is null then base->>'signature' else md5((base->>'signature')||process::text) end;
 return base||jsonb_build_object('signature',signature,'tested',coalesce((select tested_signature=signature from business_setup where business_id=p_business_id),false));
end $$;
revoke all on function public.business_setup_status(uuid),public.pre_process_business_setup_status(uuid) from public,anon,authenticated;
grant execute on function public.business_setup_status(uuid),public.pre_process_business_setup_status(uuid) to service_role;
