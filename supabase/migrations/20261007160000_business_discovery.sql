-- Durable, resumable source discovery. No provider credentials in checkpoints.
alter table public.instagram_connections add column discovery_generation uuid not null default gen_random_uuid();

create table public.business_discovery (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 draft jsonb not null default '{"entities":[],"conflicts":[],"missingInformation":[],"suggestedClarifications":[]}',
 signals jsonb,
 signals_source text not null default 'generated' check(signals_source in ('generated','manual')),
 baseline jsonb not null,
 revision integer not null default 0,
 intelligence_revision integer not null default 0,
 confirmed_at timestamptz,
 updated_at timestamptz not null default now()
);
create table public.business_discovery_jobs (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete set null,
 source text not null check(source in ('instagram','website')),
 input jsonb not null default '{}',
 status text not null default 'queued' check(status in ('queued','running','completed','failed')),
 stage text not null default 'capture',
 checkpoint jsonb not null default '{}',
 attempts integer not null default 0,
 lease_token uuid,
 leased_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index discovery_one_active_source on public.business_discovery_jobs(business_id,source) where status in ('queued','running');
create index discovery_due_jobs on public.business_discovery_jobs(next_attempt_at) where status in ('queued','running');
alter table public.business_discovery enable row level security;
alter table public.business_discovery_jobs enable row level security;
create policy discovery_member_read on public.business_discovery for select to authenticated using(public.is_business_member(business_id) or public.is_platform_admin());
-- Checkpoints contain source material; authenticated clients read progress via
-- the authorized API, rather than receiving all captured content.
grant select on public.business_discovery to authenticated;
grant all on public.business_discovery,public.business_discovery_jobs to service_role;

create function public.enqueue_business_discovery(p_business uuid,p_user uuid,p_source text,p_input jsonb,p_force boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 perform 1 from businesses where id=p_business for update;
 if not found or not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized';end if;
 if p_source not in ('instagram','website') then raise exception 'invalid_source';end if;
 if p_source='instagram' and not exists(select 1 from instagram_connections where business_id=p_business and id=(p_input->>'connectionId')::uuid and discovery_generation=(p_input->>'generation')::uuid and status='connected') then raise exception 'connection_changed';end if;
 if p_source='website' and (length(coalesce(p_input->>'url',''))>2000 or coalesce(p_input->>'url','') !~ '^https?://') then raise exception 'invalid_website';end if;
 -- A relink/new URL supersedes the old input; its worker loses its lease.
 update business_discovery_jobs set status='failed',error='Burimi u zëvendësua nga një lidhje e re.',lease_token=null,leased_until=null,updated_at=now()
 where business_id=p_business and source=p_source and status in ('queued','running') and input is distinct from p_input;
 select id into v_id from business_discovery_jobs where business_id=p_business and source=p_source and status in ('queued','running');
 if v_id is not null then return v_id;end if;
 if not p_force then
  select id into v_id from business_discovery_jobs where business_id=p_business and source=p_source and input=p_input and status='completed' order by created_at desc limit 1;
  if v_id is not null then return v_id;end if;
 end if;
 if (select count(*) from business_discovery_jobs where business_id=p_business and created_at>now()-interval '24 hours')>=12 then raise exception 'daily_limit';end if;
 insert into business_discovery(business_id,baseline,draft,intelligence_revision) values(p_business,intelligence_snapshot(p_business),coalesce((select data from business_intelligence where business_id=p_business),'{"entities":[],"conflicts":[],"missingInformation":[],"suggestedClarifications":[]}'::jsonb),coalesce((select revision from business_intelligence where business_id=p_business),0)) on conflict do nothing;
 update business_discovery set baseline=case when confirmed_at is not null then intelligence_snapshot(p_business) else baseline end,confirmed_at=null,revision=revision+1,updated_at=now() where business_id=p_business;
 insert into business_discovery_jobs(business_id,user_id,source,input) values(p_business,p_user,p_source,p_input) returning id into v_id;
 return v_id;
end $$;

create function public.save_business_discovery(p_business uuid,p_revision integer,p_draft jsonb,p_signals jsonb,p_refresh boolean default false,p_intelligence_revision integer default 0)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 perform 1 from businesses where id=p_business for update;
 update business_discovery set draft=p_draft,signals=p_signals,signals_source='manual',revision=revision+1,intelligence_revision=p_intelligence_revision,
 baseline=case when p_refresh then intelligence_snapshot(p_business) else baseline end,
 updated_at=now() where business_id=p_business and revision=p_revision;
 return found;
end $$;

create function public.claim_business_discovery(p_business uuid default null)
returns setof public.business_discovery_jobs language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 update business_discovery_jobs set status='failed',error='Analiza u ndërpre pas tri provash. Provo përsëri.',lease_token=null,leased_until=null,updated_at=now()
 where (p_business is null or business_id=p_business) and status='running' and leased_until<now() and attempts>=3;
 select id into v_id from business_discovery_jobs
 where (p_business is null or business_id=p_business) and next_attempt_at<=now()
 and (status='queued' or (status='running' and leased_until<now()))
 order by updated_at,id for update skip locked limit 1;
 if v_id is null then return;end if;
 return query update business_discovery_jobs set status='running',lease_token=gen_random_uuid(),leased_until=now()+interval '3 minutes',attempts=attempts+1,updated_at=now() where id=v_id returning *;
end $$;

create function public.checkpoint_business_discovery(p_job uuid,p_lease uuid,p_checkpoint jsonb,p_stage text,p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update business_discovery_jobs set checkpoint=p_checkpoint,stage=p_stage,
 status=case when p_error is not null and attempts>=3 then 'failed' else 'queued' end,
 error=p_error,attempts=case when p_error is null then 0 else attempts end,
 next_attempt_at=now()+case when p_error is null then interval '0 seconds' else interval '30 seconds' end,
 lease_token=null,leased_until=null,updated_at=now()
 where id=p_job and status='running' and lease_token=p_lease and leased_until>now();
 return found;
end $$;

create function public.finish_business_discovery(p_job uuid,p_lease uuid,p_revision integer,p_draft jsonb,p_signals jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare j business_discovery_jobs;
begin
 select * into j from business_discovery_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from businesses where id=j.business_id for update;
 select * into j from business_discovery_jobs where id=p_job for update;
 if j.status<>'running' or j.lease_token is distinct from p_lease or j.leased_until<=now() then return false;end if;
 if j.source='instagram' and not exists(select 1 from instagram_connections where business_id=j.business_id and id=(j.input->>'connectionId')::uuid and discovery_generation=(j.input->>'generation')::uuid and status='connected') then raise exception 'connection_changed';end if;
 update business_discovery set draft=p_draft,signals=case when signals_source='manual' then signals else p_signals end,revision=revision+1,updated_at=now() where business_id=j.business_id and revision=p_revision;
 if not found then return false;end if;
 insert into business_intelligence_sources(business_id,user_id,source,reference,transcript,extracted,status)
 values(j.business_id,j.user_id,j.source,coalesce(j.checkpoint->>'reference','discovery:'||j.id),j.checkpoint->>'text',j.checkpoint->'entities','completed');
 update business_discovery_jobs set status='completed',stage='done',lease_token=null,leased_until=null,error=null,updated_at=now() where id=p_job;
 return true;
end $$;

create function public.confirm_business_discovery(p_business uuid,p_user uuid,p_revision integer,p_intelligence_revision integer,p_draft jsonb,p_entities jsonb,p_profile jsonb,p_answers jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare d business_discovery; e jsonb; v_type uuid; v_workflow uuid; v_key text; v_name text; old_products uuid[]; agent_id uuid;
begin
 perform 1 from businesses where id=p_business for update;
 if not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized';end if;
 select * into d from business_discovery where business_id=p_business for update;
 if not found then raise exception 'stale_draft';end if;
 if d.confirmed_at is not null then return;end if;
 if d.revision<>p_revision then raise exception 'stale_draft';end if;
 if exists(select 1 from business_discovery_jobs where business_id=p_business and status in ('queued','running')) then raise exception 'busy';end if;
 if d.baseline is distinct from intelligence_snapshot(p_business) then raise exception 'platform_changed';end if;
 select coalesce(array_agg(id),'{}') into old_products from products where business_id=p_business;
 insert into business_intelligence(business_id,baseline) values(p_business,d.baseline) on conflict do nothing;
 perform 1 from business_intelligence where business_id=p_business and revision=p_intelligence_revision for update;
 if not found then raise exception 'stale_draft';end if;
 update business_intelligence set baseline=d.baseline where business_id=p_business;
 perform apply_intelligence(p_business,p_user,p_intelligence_revision,p_draft,p_entities);
 -- Global templates are recommendations; copy valid templates only for new
 -- confirmed products. Existing product/workflow choices remain authoritative.
 for e in select * from jsonb_array_elements(p_entities) where value->>'target'='product' loop
  if (e->>'id')::uuid=any(old_products) then continue;end if;
  v_key:=case
   when exists(select 1 from jsonb_array_elements(e->'facts') f where f->>'field'='personalization' and length(coalesce(f->>'value',''))>0) then 'personalized'
   when exists(select 1 from jsonb_array_elements(e->'facts') f where f->>'field'='variants' and length(coalesce(f->>'value',''))>0) then 'variants'
   else 'standard' end;
  select id,name into v_type,v_name from product_types where external_key=v_key and is_active order by sort_order,id limit 1;
  if v_type is null or not exists(select 1 from product_type_steps where product_type_id=v_type)
   or not exists(select 1 from product_type_steps where product_type_id=v_type and kind='customer' and position=(select max(position) from product_type_steps where product_type_id=v_type)) then continue;end if;
  select id into v_workflow from workflows where business_id=p_business and name='Workflow – '||v_name and exists(select 1 from workflow_steps where workflow_id=workflows.id and kind='customer' and position=(select max(position) from workflow_steps where workflow_id=workflows.id)) order by created_at,id limit 1;
  if v_workflow is null then
   insert into workflows(business_id,name) values(p_business,'Workflow – '||v_name) returning id into v_workflow;
   insert into workflow_steps(workflow_id,key,position,kind,required,config) select v_workflow,key,position,kind,required,config from product_type_steps where product_type_id=v_type;
  end if;
  update products set product_type_id=v_type,workflow_id=v_workflow,is_active=true,updated_at=now() where id=(e->>'id')::uuid and business_id=p_business;
 end loop;
 -- Preparing/activating an agent does not enable automatic replies.
 if not exists(select 1 from ai_agents where business_id=p_business and is_active) then
  select (value->>'id')::uuid into agent_id from jsonb_array_elements(p_entities) where value->>'target'='agent' limit 1;
  if agent_id is not null then update ai_agents set is_active=true,updated_at=now() where id=agent_id and business_id=p_business;end if;
 end if;
 update businesses set dashboard_profile=p_profile,updated_at=now() where id=p_business;
 update business_onboarding set answers=p_answers,updated_at=now() where business_id=p_business;
 update business_intelligence set baseline=intelligence_snapshot(p_business) where business_id=p_business;
 update business_discovery set draft=p_draft,signals=p_profile->'signals',baseline=intelligence_snapshot(p_business),confirmed_at=now(),revision=revision+1,intelligence_revision=p_intelligence_revision+1,updated_at=now() where business_id=p_business;
end $$;

revoke all on function public.enqueue_business_discovery(uuid,uuid,text,jsonb,boolean),public.claim_business_discovery(uuid),public.checkpoint_business_discovery(uuid,uuid,jsonb,text,text),public.finish_business_discovery(uuid,uuid,integer,jsonb,jsonb),public.confirm_business_discovery(uuid,uuid,integer,integer,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_business_discovery(uuid,uuid,text,jsonb,boolean),public.claim_business_discovery(uuid),public.checkpoint_business_discovery(uuid,uuid,jsonb,text,text),public.finish_business_discovery(uuid,uuid,integer,jsonb,jsonb),public.confirm_business_discovery(uuid,uuid,integer,integer,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.save_business_discovery(uuid,integer,jsonb,jsonb,boolean,integer) from public,anon,authenticated;
grant execute on function public.save_business_discovery(uuid,integer,jsonb,jsonb,boolean,integer) to service_role;
