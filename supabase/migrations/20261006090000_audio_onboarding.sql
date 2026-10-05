-- Audio bytes are transient. Keep transcripts/extractions separate from user edits.
-- Idempotent: safe if an earlier draft of this migration already created objects.
create table if not exists public.onboarding_audio_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.business_onboarding(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  base_answers jsonb not null,
  transcript text,
  extracted jsonb,
  prefilled_answers jsonb,
  response_id text,
  created_at timestamptz not null default now()
);
create index if not exists onboarding_audio_attempts_user_created
  on public.onboarding_audio_attempts(user_id, created_at desc);
alter table public.onboarding_audio_attempts enable row level security;
drop policy if exists "own audio onboarding history" on public.onboarding_audio_attempts;
create policy "own audio onboarding history"
  on public.onboarding_audio_attempts
  for select to authenticated
  using (user_id = auth.uid());
grant select on public.onboarding_audio_attempts to authenticated;
grant all on public.onboarding_audio_attempts to service_role;

create or replace function public.claim_onboarding_audio(p_user_id uuid, p_answers jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform id from public.profiles where id=p_user_id for update;
  if not found then raise exception 'profile_missing'; end if;
  if exists (select 1 from public.business_users where user_id=p_user_id)
    or exists (select 1 from public.platform_admins where user_id=p_user_id)
    or exists (select 1 from public.business_onboarding where user_id=p_user_id and completed_at is not null)
    then raise exception 'onboarding_unavailable'; end if;
  if (select count(*) from public.onboarding_audio_attempts where user_id=p_user_id and created_at > now()-interval '24 hours') >= 12
    then raise exception 'audio_daily_limit'; end if;
  if exists (select 1 from public.onboarding_audio_attempts where user_id=p_user_id and status='pending' and created_at > now()-interval '3 minutes')
    then raise exception 'audio_busy'; end if;
  update public.onboarding_audio_attempts set status='failed' where user_id=p_user_id and status='pending';
  perform public.save_onboarding_draft(p_user_id, p_answers, 0);
  insert into public.onboarding_audio_attempts(user_id, base_answers) values(p_user_id,p_answers) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finish_onboarding_audio(p_user_id uuid, p_id uuid, p_transcript text, p_extracted jsonb, p_answers jsonb, p_response_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_base jsonb; v_current jsonb;
begin
  perform id from public.profiles where id=p_user_id for update;
  select base_answers into v_base from public.onboarding_audio_attempts where id=p_id and user_id=p_user_id and status='pending' for update;
  if not found then return false; end if;
  update public.onboarding_audio_attempts set status='completed', transcript=p_transcript,
    extracted=p_extracted, prefilled_answers=p_answers, response_id=p_response_id where id=p_id;
  select answers into v_current from public.business_onboarding where user_id=p_user_id and completed_at is null;
  if v_current is distinct from v_base
    or exists (select 1 from public.business_users where user_id=p_user_id)
    or exists (select 1 from public.platform_admins where user_id=p_user_id) then return false; end if;
  perform public.save_onboarding_draft(p_user_id, p_answers, 0);
  return true;
end;
$$;
revoke all on function public.claim_onboarding_audio(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.finish_onboarding_audio(uuid,uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_onboarding_audio(uuid,jsonb) to service_role;
grant execute on function public.finish_onboarding_audio(uuid,uuid,text,jsonb,jsonb,text) to service_role;
