-- Allow accounts that finished onboarding but lost every membership
-- (deleted/orphaned business) to create a new workspace.
create or replace function public.complete_business_onboarding(p_user_id uuid, p_answers jsonb, p_instructions text)
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
  select b.slug into v_slug from public.business_users bu join public.businesses b on b.id = bu.business_id
    where bu.user_id = p_user_id order by b.name, b.id limit 1;
  if v_slug is not null then return v_slug; end if;
  -- Orphaned completion: finished earlier, but no business membership remains.
  delete from public.business_onboarding
    where user_id = p_user_id
      and completed_at is not null
      and not exists (select 1 from public.business_users where user_id = p_user_id);
  if exists (select 1 from public.business_onboarding where user_id = p_user_id and completed_at is not null) then
    raise exception 'This account already completed onboarding. Contact an administrator.';
  end if;
  v_name := btrim(p_answers->>'name');
  if v_name is null or length(v_name) < 2 or length(v_name) > 100
    or jsonb_typeof(p_answers->'useCases') is distinct from 'array'
    or length(coalesce(p_instructions,'')) = 0 then raise exception 'Invalid onboarding answers'; end if;
  v_business_id := gen_random_uuid();
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
