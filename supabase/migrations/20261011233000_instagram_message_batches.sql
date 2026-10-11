-- Apply before deploying batch-aware workers. Legacy workers cannot reclaim a
-- frozen batch. Rollback must drain these batches with a batch-aware worker.
begin;
alter table public.workflow_inbound_queue
 add column batch_parent_id bigint references public.workflow_inbound_queue(id) on delete cascade,
 add column batch_payloads jsonb;
alter table public.workflow_inbound_queue drop constraint workflow_inbound_queue_status_check;
alter table public.workflow_inbound_queue add constraint workflow_inbound_queue_status_check
 check(status in ('queued','processing','prepared','sending','sent','ignored','failed','uncertain','batched'));
create index workflow_inbound_batch_parent on public.workflow_inbound_queue(batch_parent_id) where batch_parent_id is not null;

-- A quiet interval of 3s, capped at 10s from the first queued message.
create function public.workflow_inbound_ready_at(p_connection uuid,p_participant text) returns timestamptz
language sql stable security definer set search_path=public as $$
 select least(min(created_at)+interval '10 seconds',max(created_at)+interval '3 seconds')
 from (select created_at from workflow_inbound_queue
  where connection_id=p_connection and participant_id=p_participant and channel='instagram'
   and status='queued' and attempts=0 order by id limit 20) pending;
$$;

create or replace function public.claim_workflow_inbound(p_businesses uuid[]) returns setof public.workflow_inbound_queue language plpgsql security definer set search_path=public as $$
declare candidate public.workflow_inbound_queue;
begin
 -- A send may have reached Meta before the worker died. Never resend it automatically.
 update conversations set status='paused',auto_reply=false where id in (select conversation_id from workflow_inbound_queue where (p_businesses is null or channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now());
 update workflow_inbound_queue set status='uncertain',error='Delivery requires staff verification' where (p_businesses is null or channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now();
 for candidate in select q.* from workflow_inbound_queue q where q.batch_payloads is null and (p_businesses is null or q.channel='whatsapp' or q.business_id=any(p_businesses)) and (q.status in ('queued','prepared') or(q.status='processing' and q.leased_until<now())) and (q.leased_until is null or q.leased_until<now())
  and not exists(select 1 from workflow_inbound_queue earlier where earlier.connection_id=q.connection_id and earlier.participant_id=q.participant_id and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending'))
  order by q.id limit 20 loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.connection_id::text||':'||candidate.participant_id,0)) then continue; end if;
  -- FOR-loop cursors may prefetch rows. Lock only this candidate, then recheck
  -- eligibility after acquiring the participant lock against a fresh snapshot.
  select q.* into candidate from workflow_inbound_queue q where q.id=candidate.id and q.batch_payloads is null and (p_businesses is null or q.channel='whatsapp' or q.business_id=any(p_businesses)) and (q.status in ('queued','prepared') or(q.status='processing' and q.leased_until<now())) and (q.leased_until is null or q.leased_until<now())
  and not exists(select 1 from workflow_inbound_queue earlier where earlier.connection_id=q.connection_id and earlier.participant_id=q.participant_id and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending')) for update skip locked;
  if not found then continue; end if;
  if candidate.attempts>=3 then
   update workflow_inbound_queue set status='failed',error='Processing retries exhausted' where id=candidate.id;
   update conversations set status='paused',auto_reply=false where business_id=candidate.business_id and channel=candidate.channel and coalesce(whatsapp_participant_id,instagram_participant_id)=candidate.participant_id and coalesce(whatsapp_connection_id,instagram_connection_id)=candidate.connection_id and status='active';
   continue;
  end if;
  return query update workflow_inbound_queue set status=case when status='prepared' then 'prepared' else 'processing' end,lease_token=gen_random_uuid(),leased_until=now()+interval '120 seconds',attempts=attempts+1 where id=candidate.id returning *;
  return;
 end loop;
end $$;


create or replace function public.claim_workflow_inbound_batch(p_businesses uuid[]) returns setof public.workflow_inbound_queue language plpgsql security definer set search_path=public as $$
declare candidate public.workflow_inbound_queue; members bigint[]; messages jsonb;
begin
 -- A send may have reached Meta before the worker died. Never resend it automatically.
 update conversations set status='paused',auto_reply=false where id in (select conversation_id from workflow_inbound_queue where (p_businesses is null or channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now());
 update workflow_inbound_queue set status='uncertain',error='Delivery requires staff verification' where (p_businesses is null or channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now();
 for candidate in select q.* from workflow_inbound_queue q where (p_businesses is null or q.channel='whatsapp' or q.business_id=any(p_businesses)) and (q.status in ('queued','prepared') or(q.status='processing' and q.leased_until<now())) and (q.leased_until is null or q.leased_until<now())
  and not exists(select 1 from workflow_inbound_queue earlier where earlier.connection_id=q.connection_id and earlier.participant_id=q.participant_id and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending'))
  and (q.channel<>'instagram' or q.status<>'queued' or q.attempts>0 or clock_timestamp()>=public.workflow_inbound_ready_at(q.connection_id,q.participant_id))
  order by q.id limit 20 loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.connection_id::text||':'||candidate.participant_id,0)) then continue; end if;
  -- FOR-loop cursors may prefetch rows. Lock only this candidate, then recheck
  -- eligibility after acquiring the participant lock against a fresh snapshot.
  select q.* into candidate from workflow_inbound_queue q where q.id=candidate.id and (p_businesses is null or q.channel='whatsapp' or q.business_id=any(p_businesses)) and (q.status in ('queued','prepared') or(q.status='processing' and q.leased_until<now())) and (q.leased_until is null or q.leased_until<now())
  and not exists(select 1 from workflow_inbound_queue earlier where earlier.connection_id=q.connection_id and earlier.participant_id=q.participant_id and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending'))
  and (q.channel<>'instagram' or q.status<>'queued' or q.attempts>0 or clock_timestamp()>=public.workflow_inbound_ready_at(q.connection_id,q.participant_id)) for update skip locked;
  if not found then continue; end if;
  if candidate.attempts>=3 then
   update workflow_inbound_queue set status='failed',error='Processing retries exhausted' where id=candidate.id;
   update conversations set status='paused',auto_reply=false where business_id=candidate.business_id and channel=candidate.channel and coalesce(whatsapp_participant_id,instagram_participant_id)=candidate.participant_id and coalesce(whatsapp_connection_id,instagram_connection_id)=candidate.connection_id and status='active';
   continue;
  end if;
  if candidate.channel='instagram' and candidate.status='queued' and candidate.attempts=0 then
   -- Freeze membership under the same participant lock as the claim. Retries use
   -- this snapshot; later arrivals can never change an already prepared reply.
   select array_agg(member.id order by member.id),jsonb_agg(member.payload order by member.id) into members,messages from (
    select q.id,q.payload from workflow_inbound_queue q
    where q.connection_id=candidate.connection_id and q.participant_id=candidate.participant_id
     and q.channel='instagram' and q.business_id=candidate.business_id
     and q.status='queued' and q.attempts=0
    order by q.id limit 20 for update
   ) member;
   update workflow_inbound_queue set batch_payloads=messages where id=candidate.id;
   update workflow_inbound_queue set status='batched',batch_parent_id=candidate.id
    where id=any(members) and id<>candidate.id;
  end if;
  return query update workflow_inbound_queue set status=case when status='prepared' then 'prepared' else 'processing' end,lease_token=gen_random_uuid(),leased_until=now()+interval '120 seconds',attempts=attempts+1 where id=candidate.id returning *;
  return;
 end loop;
end $$;

-- Allows webhook workers to wake after the quiet interval instead of relying on
-- the recovery cron. An active earlier job owns its stream; do not spin for it.
create function public.workflow_inbound_batch_wait_ms() returns integer
language sql stable security definer set search_path=public as $$
 select case when count(*)=0 then 0 else least(3000,greatest(1,ceil(extract(epoch from (min(public.workflow_inbound_ready_at(q.connection_id,q.participant_id))-statement_timestamp()))*1000)))::integer end
 from workflow_inbound_queue q where q.channel='instagram' and q.status='queued' and q.attempts=0
 and (q.leased_until is null or q.leased_until<statement_timestamp())
 and not exists(select 1 from workflow_inbound_queue earlier where earlier.connection_id=q.connection_id and earlier.participant_id=q.participant_id
  and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending'));
$$;
revoke all on function public.workflow_inbound_ready_at(uuid,text),public.claim_workflow_inbound_batch(uuid[]),public.workflow_inbound_batch_wait_ms() from public,anon,authenticated;
grant execute on function public.workflow_inbound_ready_at(uuid,text),public.claim_workflow_inbound_batch(uuid[]),public.workflow_inbound_batch_wait_ms() to service_role;
commit;
