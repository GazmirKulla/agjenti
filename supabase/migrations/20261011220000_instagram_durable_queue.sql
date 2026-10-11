-- NULL selects all tenants. Explicit pilot lists remain supported for older workers.
-- Apply before deploying the webhook that queues all Instagram messages.
-- Drain in-flight legacy webhook executions before starting workers from the new deployment.
begin;
create or replace function public.claim_workflow_inbound(p_businesses uuid[]) returns setof public.workflow_inbound_queue language plpgsql security definer set search_path=public as $$
declare candidate public.workflow_inbound_queue;
begin
 -- A send may have reached Meta before the worker died. Never resend it automatically.
 update conversations set status='paused',auto_reply=false where id in (select conversation_id from workflow_inbound_queue where (p_businesses is null or channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now());
 update workflow_inbound_queue set status='uncertain',error='Delivery requires staff verification' where (p_businesses is null or channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now();
 for candidate in select q.* from workflow_inbound_queue q where (p_businesses is null or q.channel='whatsapp' or q.business_id=any(p_businesses)) and (q.status in ('queued','prepared') or(q.status='processing' and q.leased_until<now())) and (q.leased_until is null or q.leased_until<now())
  and not exists(select 1 from workflow_inbound_queue earlier where earlier.connection_id=q.connection_id and earlier.participant_id=q.participant_id and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending'))
  order by q.id for update skip locked limit 20 loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.connection_id::text||':'||candidate.participant_id,0)) then continue; end if;
  if candidate.attempts>=3 then
   update workflow_inbound_queue set status='failed',error='Processing retries exhausted' where id=candidate.id;
   update conversations set status='paused',auto_reply=false where business_id=candidate.business_id and channel=candidate.channel and coalesce(whatsapp_participant_id,instagram_participant_id)=candidate.participant_id and coalesce(whatsapp_connection_id,instagram_connection_id)=candidate.connection_id and status='active';
   continue;
  end if;
  return query update workflow_inbound_queue set status=case when status='prepared' then 'prepared' else 'processing' end,lease_token=gen_random_uuid(),leased_until=now()+interval '120 seconds',attempts=attempts+1 where id=candidate.id returning *;
  return;
 end loop;
end $$;

revoke all on function public.claim_workflow_inbound(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_workflow_inbound(uuid[]) to service_role;
commit;
