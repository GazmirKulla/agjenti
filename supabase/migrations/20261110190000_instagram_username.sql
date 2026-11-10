-- Instagram by username: the business gives its public @username (in
-- onboarding or under Knowledge) and Agjenti reads its public profile and posts
-- without the business connecting its account.
begin;

alter table public.businesses add column if not exists instagram_username text;
alter table public.businesses drop constraint if exists businesses_instagram_username_format;
alter table public.businesses add constraint businesses_instagram_username_format
 check (instagram_username is null or instagram_username ~ '^[a-z0-9._]{1,30}$');

CREATE OR REPLACE FUNCTION public.enqueue_business_discovery(p_business uuid, p_user uuid, p_source text, p_input jsonb, p_force boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
 perform 1 from businesses where id=p_business for update;
 if not found or not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized';end if;
 if p_source not in ('instagram','website') then raise exception 'invalid_source';end if;
 -- Instagram is read through the business's connection, or publicly by username.
 if p_source='instagram' and p_input ? 'username' then
  if coalesce(p_input->>'username','') !~ '^[a-z0-9._]{1,30}$' then raise exception 'invalid_username';end if;
 elsif p_source='instagram' and not exists(select 1 from instagram_connections where business_id=p_business and id=(p_input->>'connectionId')::uuid and discovery_generation=(p_input->>'generation')::uuid and status='connected') then raise exception 'connection_changed';end if;
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
end $function$;

commit;
