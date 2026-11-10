-- Onboarding step 2: "Where the agent learns from".
-- 1) A quick look at the public Instagram profile and the website's first page,
--    kept here so the later analysis reuses it instead of fetching again.
-- 2) A scan in review mode ends as a proposal: its knowledge is saved inactive
--    and the panel, agent and process it suggests wait in the job's checkpoint.
-- 3) The owner confirms (chosen knowledge goes live, the rest of the proposal is
--    applied) or dismisses it (nothing changes, the proposed entries go away).
begin;

create table if not exists public.business_source_previews (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 instagram jsonb,
 website jsonb,
 about_knowledge_id uuid references public.knowledge_entries(id) on delete set null,
 fetch_count integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.business_source_previews enable row level security;
revoke all on public.business_source_previews from anon, authenticated;
grant all on public.business_source_previews to service_role;

create or replace function public.finish_discovery_review(p_job uuid, p_lease uuid, p_revision integer, p_draft jsonb, p_signals jsonb, p_knowledge jsonb, p_review jsonb)
returns boolean language plpgsql security definer set search_path=public, pg_temp as $$
declare j business_discovery_jobs; routed jsonb; proposed jsonb;
begin
 select * into j from business_discovery_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from businesses where id=j.business_id for update;
 if jsonb_typeof(p_review) is distinct from 'object' then raise exception 'invalid_review';end if;
 -- Lease, revision, draft, history and completion as for every scan.
 if not finish_business_discovery(p_job,p_lease,p_revision,p_draft,p_signals) then return false;end if;
 routed:=route_scan_knowledge(j.business_id,p_knowledge);
 -- New answers wait for the owner. Entries held back as a second answer to an
 -- existing title stay inactive as before and are not part of the proposal.
 select coalesce(jsonb_agg(id::text),'[]'::jsonb) into proposed from knowledge_entries
  where business_id=j.business_id and is_active and coalesce(routed->'insertedIds','[]'::jsonb) ? id::text;
 update knowledge_entries set is_active=false,updated_at=now() where business_id=j.business_id and proposed ? id::text;
 update business_discovery_jobs set checkpoint=checkpoint||jsonb_build_object(
   'knowledgeCount',routed->'count','inactiveKnowledgeCount',routed->'inactiveCount',
   'review',jsonb_build_object('status','pending','knowledgeIds',proposed,
     'profile',p_review->'profile','agent',p_review->'agent','process',p_review->'process'))
  where id=p_job;
 return true;
end $$;

-- p_keep: the proposed knowledge to publish; null dismisses the whole proposal.
create or replace function public.review_discovery(p_business uuid, p_user uuid, p_keep jsonb)
returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare j business_discovery_jobs; r jsonb; n integer; kept integer:=0; removed integer:=0; agent uuid; keep jsonb:=coalesce(p_keep,'[]'::jsonb);
begin
 perform 1 from businesses where id=p_business for update;
 if not found or not(exists(select 1 from business_users where business_id=p_business and user_id=p_user)
   or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized';end if;
 if jsonb_typeof(keep)<>'array' or jsonb_array_length(keep)>200 then raise exception 'invalid_request';end if;
 for j in select * from business_discovery_jobs where business_id=p_business and status='completed'
   and checkpoint->'review'->>'status'='pending' order by updated_at for update loop
  r:=j.checkpoint->'review';
  update knowledge_entries set is_active=true,updated_at=now()
   where business_id=p_business and not is_active and r->'knowledgeIds' ? id::text and keep ? id::text;
  get diagnostics n=row_count; kept:=kept+n;
  -- Entries the owner already published or edited into use are left alone.
  delete from knowledge_entries
   where business_id=p_business and not is_active and r->'knowledgeIds' ? id::text and not keep ? id::text;
  get diagnostics n=row_count; removed:=removed+n;
  if p_keep is not null then
   -- The panel, unless the owner set it up by hand.
   if jsonb_typeof(r->'profile')='object' and coalesce(r->'profile'->>'version','')='1' then
    update businesses set dashboard_profile=r->'profile',updated_at=now()
     where id=p_business and coalesce(dashboard_profile->>'source','')<>'manual';
   end if;
   -- The agent, only while it is still the untouched starter or generated one.
   if jsonb_typeof(r->'agent')='object' and length(btrim(coalesce(r->'agent'->>'instructions','')))>0
     and length(r->'agent'->>'instructions')<=8000 then
    agent:=(r->'agent'->>'id')::uuid;
    if r->'agent'->>'expectedInstructions' is not null then
     update ai_agents set instructions=r->'agent'->>'instructions',is_active=true,updated_at=now()
      where id=agent and business_id=p_business and instructions=r->'agent'->>'expectedInstructions'
      and not exists(select 1 from ai_agents o where o.business_id=p_business and o.is_active and o.id<>agent);
    elsif not exists(select 1 from ai_agents where business_id=p_business) then
     insert into ai_agents(id,business_id,name,instructions,is_active) values(agent,p_business,'Agjenti i biznesit',r->'agent'->>'instructions',true);
    end if;
   end if;
   -- The working process, unless the owner wrote one.
   if jsonb_typeof(r->'process')='object' then
    update business_discovery set operating_workflow=r->'process',process_revision=process_revision+1,updated_at=now()
     where business_id=p_business and coalesce(operating_workflow->>'source','')<>'manual';
   end if;
  end if;
  update business_discovery_jobs set checkpoint=jsonb_set(checkpoint,'{review,status}',
    to_jsonb(case when p_keep is null then 'dismissed' else 'confirmed' end)),updated_at=now()
   where id=j.id;
 end loop;
 return jsonb_build_object('kept',kept,'removed',removed);
end $$;

revoke all on function public.finish_discovery_review(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb), public.review_discovery(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.finish_discovery_review(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb), public.review_discovery(uuid,uuid,jsonb) to service_role;

commit;
