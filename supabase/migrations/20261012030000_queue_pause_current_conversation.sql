-- Exhausted/uncertain queue jobs must not pause a newer active conversation
-- for the same WhatsApp/Instagram participant after the old thread was deleted.
begin;

create or replace function public.claim_workflow_inbound(p_businesses uuid[]) returns setof public.workflow_inbound_queue language plpgsql security definer set search_path=public as $$
declare candidate public.workflow_inbound_queue;
begin
 update conversations set status='paused',auto_reply=false where id in (select conversation_id from workflow_inbound_queue where (p_businesses is null or channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now());
 update workflow_inbound_queue set status='uncertain',error='Delivery requires staff verification' where (p_businesses is null or channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now();
 for candidate in select q.* from workflow_inbound_queue q where q.batch_payloads is null and (p_businesses is null or q.channel='whatsapp' or q.business_id=any(p_businesses)) and (q.status in ('queued','prepared') or(q.status='processing' and q.leased_until<now())) and (q.leased_until is null or q.leased_until<now())
  and not exists(select 1 from workflow_inbound_queue earlier where earlier.connection_id=q.connection_id and earlier.participant_id=q.participant_id and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending'))
  order by q.id limit 20 loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.connection_id::text||':'||candidate.participant_id,0)) then continue; end if;
  select q.* into candidate from workflow_inbound_queue q where q.id=candidate.id and q.batch_payloads is null and (p_businesses is null or q.channel='whatsapp' or q.business_id=any(p_businesses)) and (q.status in ('queued','prepared') or(q.status='processing' and q.leased_until<now())) and (q.leased_until is null or q.leased_until<now())
  and not exists(select 1 from workflow_inbound_queue earlier where earlier.connection_id=q.connection_id and earlier.participant_id=q.participant_id and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending')) for update skip locked;
  if not found then continue; end if;
  if candidate.attempts>=3 then
   update workflow_inbound_queue set status='failed',error='Processing retries exhausted' where id=candidate.id;
   if candidate.conversation_id is not null then
    update conversations set status='paused',auto_reply=false where id=candidate.conversation_id and business_id=candidate.business_id and status='active';
   end if;
   continue;
  end if;
  return query update workflow_inbound_queue set status=case when status='prepared' then 'prepared' else 'processing' end,lease_token=gen_random_uuid(),leased_until=now()+interval '120 seconds',attempts=attempts+1 where id=candidate.id returning *;
  return;
 end loop;
end $$;

create or replace function public.claim_workflow_inbound_batch(p_businesses uuid[]) returns setof public.workflow_inbound_queue language plpgsql security definer set search_path=public as $$
declare candidate public.workflow_inbound_queue; members bigint[]; messages jsonb;
begin
 update conversations set status='paused',auto_reply=false where id in (select conversation_id from workflow_inbound_queue where (p_businesses is null or channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now());
 update workflow_inbound_queue set status='uncertain',error='Delivery requires staff verification' where (p_businesses is null or channel='whatsapp' or business_id=any(p_businesses)) and status='sending' and leased_until<now();
 for candidate in select q.* from workflow_inbound_queue q where (p_businesses is null or q.channel='whatsapp' or q.business_id=any(p_businesses)) and (q.status in ('queued','prepared') or(q.status='processing' and q.leased_until<now())) and (q.leased_until is null or q.leased_until<now())
  and not exists(select 1 from workflow_inbound_queue earlier where earlier.connection_id=q.connection_id and earlier.participant_id=q.participant_id and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending'))
  and (q.channel<>'instagram' or q.status<>'queued' or q.attempts>0 or clock_timestamp()>=public.workflow_inbound_ready_at(q.connection_id,q.participant_id))
  order by q.id limit 20 loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.connection_id::text||':'||candidate.participant_id,0)) then continue; end if;
  select q.* into candidate from workflow_inbound_queue q where q.id=candidate.id and (p_businesses is null or q.channel='whatsapp' or q.business_id=any(p_businesses)) and (q.status in ('queued','prepared') or(q.status='processing' and q.leased_until<now())) and (q.leased_until is null or q.leased_until<now())
  and not exists(select 1 from workflow_inbound_queue earlier where earlier.connection_id=q.connection_id and earlier.participant_id=q.participant_id and earlier.id<q.id and earlier.status in ('queued','processing','prepared','sending'))
  and (q.channel<>'instagram' or q.status<>'queued' or q.attempts>0 or clock_timestamp()>=public.workflow_inbound_ready_at(q.connection_id,q.participant_id)) for update skip locked;
  if not found then continue; end if;
  if candidate.attempts>=3 then
   update workflow_inbound_queue set status='failed',error='Processing retries exhausted' where id=candidate.id;
   if candidate.conversation_id is not null then
    update conversations set status='paused',auto_reply=false where id=candidate.conversation_id and business_id=candidate.business_id and status='active';
   end if;
   continue;
  end if;
  if candidate.channel='instagram' and candidate.status='queued' and candidate.attempts=0 then
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

commit;
