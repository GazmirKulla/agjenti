-- A person can create as many businesses as they like. Each completed
-- onboarding is its own row (one per business); a person has at most one
-- open draft. Messages are billed to the person (account allowance), so a new
-- business never brings a new free allowance.

alter table public.business_onboarding add column if not exists id uuid not null default gen_random_uuid();
alter table public.business_onboarding drop constraint if exists business_onboarding_pkey;
alter table public.business_onboarding add constraint business_onboarding_pkey primary key (id);
create unique index if not exists business_onboarding_one_draft
  on public.business_onboarding(user_id) where completed_at is null;
create index if not exists business_onboarding_user on public.business_onboarding(user_id);

create or replace function public.save_onboarding_draft(p_user_id uuid, p_answers jsonb, p_step integer)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform id from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Profile missing'; end if;
  if exists (select 1 from public.platform_admins where user_id = p_user_id) then return; end if;
  insert into public.business_onboarding(user_id, answers, step)
    values(p_user_id, p_answers, p_step)
    on conflict (user_id) where completed_at is null
    do update set answers = excluded.answers, step = excluded.step, updated_at = now();
end;
$$;

create or replace function public.complete_business_onboarding(p_user_id uuid, p_answers jsonb, p_instructions text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_business_id uuid;
  v_slug text;
  v_name text;
begin
  -- The profile lock serializes double submits of the same draft.
  perform id from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Profile missing'; end if;
  if exists (select 1 from public.platform_admins where user_id = p_user_id) then
    raise exception 'Platform administrators use the admin workspace';
  end if;
  v_name := btrim(p_answers->>'name');
  if v_name is null or length(v_name) < 2 or length(v_name) > 100
    or jsonb_typeof(p_answers->'useCases') is distinct from 'array'
    or length(coalesce(p_instructions,'')) = 0 then raise exception 'Invalid onboarding answers'; end if;
  -- A retried submit (double tap, lost response) returns the business it just created.
  select b.slug into v_slug from public.businesses b join public.business_users bu on bu.business_id=b.id
    where bu.user_id=p_user_id and bu.role='owner' and b.name=v_name and b.created_at > now() - interval '30 seconds'
    order by b.created_at desc limit 1;
  if v_slug is not null then return v_slug; end if;
  v_business_id := gen_random_uuid();
  v_slug := 'biznes-' || replace(v_business_id::text, '-', '');
  insert into public.businesses(id,name,slug,catalog_source,auto_reply,billing_user_id)
    values(v_business_id,v_name,v_slug,'internal',false,p_user_id);
  insert into public.business_users(business_id,user_id,role) values(v_business_id,p_user_id,'owner');
  insert into public.ai_agents(business_id,name,instructions,is_active)
    values(v_business_id,'Agjenti i ' || v_name,p_instructions,false);
  -- The open draft becomes this business's onboarding; without one, a new row.
  update public.business_onboarding
    set business_id=v_business_id, answers=p_answers, step=7, completed_at=now(), updated_at=now()
    where user_id=p_user_id and completed_at is null;
  if not found then
    insert into public.business_onboarding(user_id,business_id,answers,step,completed_at)
      values(p_user_id,v_business_id,p_answers,7,now());
  end if;
  return v_slug;
end;
$$;
