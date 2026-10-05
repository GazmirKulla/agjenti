-- Isolated test database only, after migrations. No persistent test data.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000071','audio-owner@example.test'),
 ('00000000-0000-4000-8000-000000000072','audio-other@example.test');
do $$
declare u uuid := '00000000-0000-4000-8000-000000000071';
 a jsonb := '{"name":"Test","useCases":[]}';
 v_id uuid;
begin
 v_id := public.claim_onboarding_audio(u,a);
 begin
   perform public.claim_onboarding_audio(u,a);
   raise exception 'Concurrent attempt allowed' using errcode='XX001';
 exception when raise_exception then
   if sqlerrm <> 'audio_busy' then raise; end if;
 end;
 if public.finish_onboarding_audio('00000000-0000-4000-8000-000000000072',v_id,'Wrong','{}',a,'test') then raise exception 'Cross-owner completion'; end if;
 if not public.finish_onboarding_audio(u,v_id,'Transkript prove','{}',a||'{"businessType":"services"}','test') then raise exception 'Completion failed'; end if;
 if not exists(select 1 from public.business_onboarding where user_id=u and answers->>'businessType'='services') then raise exception 'Draft was not saved'; end if;
 v_id := public.claim_onboarding_audio(u,a);
 perform public.save_onboarding_draft(u,a||'{"name":"Manual change"}',1);
 if public.finish_onboarding_audio(u,v_id,'Audio e vonuar','{}',a,'test') then raise exception 'Late audio overwrote manual edit'; end if;
 if not exists(select 1 from public.business_onboarding where user_id=u and answers->>'name'='Manual change') then raise exception 'Manual edit lost'; end if;
 if not exists(select 1 from public.onboarding_audio_attempts where id=v_id and transcript='Audio e vonuar') then raise exception 'Transcript lost'; end if;
 insert into public.onboarding_audio_attempts(user_id,base_answers,status) select u,a,'failed' from generate_series(1,10);
 begin
   perform public.claim_onboarding_audio(u,a);
   raise exception 'Daily limit not enforced' using errcode='XX001';
 exception when raise_exception then
   if sqlerrm <> 'audio_daily_limit' then raise; end if;
 end;
 if has_function_privilege('authenticated','public.claim_onboarding_audio(uuid,jsonb)','execute') or has_function_privilege('anon','public.finish_onboarding_audio(uuid,uuid,text,jsonb,jsonb,text)','execute') then raise exception 'RPC exposed'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000072',true);
do $$ begin
 if exists(select 1 from public.onboarding_audio_attempts) then raise exception 'Cross-owner read'; end if;
end $$;
reset role;
delete from public.business_onboarding where user_id='00000000-0000-4000-8000-000000000071';
do $$ begin
 if exists(select 1 from public.onboarding_audio_attempts where user_id='00000000-0000-4000-8000-000000000071') then raise exception 'Audio history did not cascade'; end if;
end $$;
rollback;
