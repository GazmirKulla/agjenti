-- Candidate bounds apply to runnable stream heads, not to blocked children.
-- The same lock/lease recheck remains authoritative after candidate selection.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function public.claim_workflow_transport(p_businesses uuid[],p_test_user uuid,p_test_stream uuid) returns setof public.workflow_inbound_queue language plpgsql security definer set search_path=public as $$
declare candidate workflow_inbound_queue; stream text;
begin
 if p_test_user is null then
  update conversations set status='paused',auto_reply=false where id in(select conversation_id from workflow_inbound_queue where status='sending' and leased_until<now() and (p_businesses is null or business_id=any(p_businesses)));
  update workflow_inbound_queue set status='uncertain',error='Provider result requires reconciliation',leased_until=null where status='sending' and leased_until<now() and (p_businesses is null or business_id=any(p_businesses));
 end if;
 for candidate in select q.* from workflow_inbound_queue q
  where (p_businesses is null or q.business_id=any(p_businesses))
   and ((p_test_user is null and q.operation_kind<>'test') or (q.operation_kind='test' and q.operator_user_id=p_test_user and q.test_stream_id=p_test_stream))
   and (q.status in ('queued','prepared') or q.status='processing' and q.leased_until<now())
   and (q.leased_until is null or q.leased_until<now()) and (q.expires_at is null or q.expires_at>now())    and not exists(select 1 from workflow_inbound_queue e where e.business_id=q.business_id and e.id<q.id
    and ((q.operation_kind='test' and e.operation_kind='test' and e.operator_user_id=q.operator_user_id and e.test_stream_id=q.test_stream_id)
      or (q.operation_kind<>'test' and e.connection_id=q.connection_id and e.participant_id=q.participant_id))
    and (e.status in ('queued','processing','prepared','sending','uncertain') or q.operation_kind='test' and e.status='failed'))
order by q.id limit 100 loop
  stream:=coalesce(candidate.connection_id::text,candidate.operator_user_id::text||':'||candidate.test_stream_id::text)||':'||candidate.participant_id;
  if not pg_try_advisory_xact_lock(hashtextextended(stream,0)) then continue; end if;
  select * into candidate from workflow_inbound_queue q where q.id=candidate.id
   and (q.status in ('queued','prepared') or q.status='processing' and q.leased_until<now()) and (q.leased_until is null or q.leased_until<now())
   and not exists(select 1 from workflow_inbound_queue e where e.business_id=q.business_id and e.id<q.id
    and ((q.operation_kind='test' and e.operation_kind='test' and e.operator_user_id=q.operator_user_id and e.test_stream_id=q.test_stream_id)
      or (q.operation_kind<>'test' and e.connection_id=q.connection_id and e.participant_id=q.participant_id))
    and (e.status in ('queued','processing','prepared','sending','uncertain') or q.operation_kind='test' and e.status='failed')) for update skip locked;
  if not found then continue; end if;
  if candidate.attempts>=3 then
   update workflow_inbound_queue set status='failed',error='Processing retries exhausted' where id=candidate.id;
   continue;
  end if;
  return query update workflow_inbound_queue set status=case when status='prepared' then 'prepared' else 'processing' end,lease_token=gen_random_uuid(),leased_until=now()+interval '180 seconds',attempts=attempts+1 where id=candidate.id returning *;
  return;
 end loop;
end $$;

-- This buffer holds only unmatched early events. Once a part is known, its
-- monotonic status is authoritative; normal traffic must not consume the cap.
create or replace function public.guard_transport_part_start() returns trigger
language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare job public.workflow_inbound_queue;
begin
 if new.status='sending' then
  select * into job from public.workflow_inbound_queue where id=new.job_id for update;
  if not found or job.status<>'sending' or job.leased_until is null or job.leased_until<=clock_timestamp() then raise exception 'lease_lost'; end if;
 end if;
 if new.external_message_id is not null then
  delete from public.message_transport_receipts
   where connection_id=new.connection_id and participant_id=new.participant_id and external_message_id=new.external_message_id;
 end if;
 return new;
end $$;
commit;
