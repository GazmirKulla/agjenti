-- Onboarding stays separate from operational tenant data and permission rules.
create table public.business_onboarding (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  business_id uuid unique references public.businesses(id) on delete set null,
  answers jsonb not null default '{}'::jsonb,
  step integer not null default 0 check (step between 0 and 7),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.business_onboarding enable row level security;
-- Read-only for owners/members. Writes go through authenticated server actions.
create policy "onboarding read" on public.business_onboarding for select to authenticated
using (user_id = auth.uid() or (business_id is not null and public.is_business_member(business_id)));
grant select on public.business_onboarding to authenticated;
grant all on public.business_onboarding to service_role;

-- Lock the existing profile, not a draft row that may not yet exist. Both draft
-- and completion use this lock so retries, tabs and late saves serialize.
create function public.save_onboarding_draft(p_user_id uuid, p_answers jsonb, p_step integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform id from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Profile missing'; end if;
  if exists (select 1 from public.platform_admins where user_id = p_user_id)
     or exists (select 1 from public.business_users where user_id = p_user_id) then return; end if;
  insert into public.business_onboarding(user_id, answers, step)
    values(p_user_id, p_answers, p_step)
    on conflict (user_id) do update set answers = excluded.answers, step = excluded.step, updated_at = now()
    where business_onboarding.completed_at is null;
end;
$$;

create function public.complete_business_onboarding(p_user_id uuid, p_answers jsonb, p_instructions text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_business_id uuid;
  v_slug text;
  v_name text;
begin
  perform id from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Profile missing'; end if;
  if exists (select 1 from public.platform_admins where user_id = p_user_id) then
    raise exception 'Platform administrators use the admin workspace';
  end if;
  -- Membership created by an administrator while the wizard was open wins.
  select b.slug into v_slug from public.business_users bu join public.businesses b on b.id = bu.business_id
    where bu.user_id = p_user_id order by b.name, b.id limit 1;
  if v_slug is not null then return v_slug; end if;
  if exists (select 1 from public.business_onboarding where user_id = p_user_id and completed_at is not null) then
    raise exception 'This account already completed onboarding. Contact an administrator.';
  end if;
  v_name := btrim(p_answers->>'name');
  if v_name is null or length(v_name) < 2 or length(v_name) > 100
    or jsonb_typeof(p_answers->'useCases') is distinct from 'array'
    or length(coalesce(p_instructions,'')) = 0 then raise exception 'Invalid onboarding answers'; end if;
  v_business_id := gen_random_uuid();
  -- A generated suffix avoids reserved names, slug races and leaking user IDs.
  v_slug := 'biznes-' || replace(v_business_id::text, '-', '');
  insert into public.businesses(id,name,slug,catalog_source,auto_reply)
    values(v_business_id,v_name,v_slug,'internal',false);
  insert into public.business_users(business_id,user_id,role) values(v_business_id,p_user_id,'owner');
  insert into public.ai_agents(business_id,name,instructions,is_active)
    values(v_business_id,'Agjenti i ' || v_name,p_instructions,false);
  insert into public.business_onboarding(user_id,business_id,answers,step,completed_at)
    values(p_user_id,v_business_id,p_answers,7,now())
    on conflict(user_id) do update set business_id=excluded.business_id, answers=excluded.answers,
      step=7, completed_at=now(), updated_at=now();
  return v_slug;
end;
$$;
-- The caller identity comes only from getUser() in the server action; browsers
-- cannot invoke these definer functions with a forged user ID.
revoke all on function public.save_onboarding_draft(uuid,jsonb,integer) from public, anon, authenticated;
revoke all on function public.complete_business_onboarding(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.save_onboarding_draft(uuid,jsonb,integer) to service_role;
grant execute on function public.complete_business_onboarding(uuid,jsonb,text) to service_role;
