-- Bounded fragments in the EXISTING transport queue. No external calls in locks.
-- Raw jobs/IDs remain durable; only the head owns execution and the frozen result.
-- Rollout: apply SQL first, then publish the fragment-aware worker. The legacy
-- 3-argument RPC cannot take new-protocol jobs or private streams with batches.
-- Rollback must retain this fence; queued new-protocol work waits for a capable
-- worker rather than being partially executed by an older release.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Read-only policy shared by claim and wakeup. Called under the existing stream
-- advisory lock when freezing. Unknown/old payloads and staff messages are singletons.
create or replace function public.workflow_fragment_window(p_id bigint)
returns table(ids bigint[], payloads jsonb, ready_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare head workflow_inbound_queue; item workflow_inbound_queue;
 last_at timestamptz; size integer:=0; body text;
begin
 select * into head from workflow_inbound_queue where id=p_id;
 ids:=array[p_id]; payloads:=null; ready_at:=statement_timestamp();
 if not found then return; end if;
 if head.status<>'queued' or head.attempts<>0 or head.batch_payloads is not null
  or head.operation_kind not in ('test','inbound') or head.payload->>'fragmentKind' is distinct from 'fragment'
 then return next; return; end if;
 ids:='{}'; payloads:='[]'; last_at:=head.created_at;
 for item in select q.* from workflow_inbound_queue q
  where q.business_id=head.business_id and q.id>=head.id
   and ((head.operation_kind='test' and q.operation_kind='test' and q.operator_user_id=head.operator_user_id and q.test_stream_id=head.test_stream_id)
    or (head.operation_kind='inbound' and q.connection_id=head.connection_id and q.participant_id=head.participant_id))
  order by q.id limit 21
 loop
  body:=coalesce(item.payload->>'message',item.payload->>'text','');
  if item.operation_kind<>head.operation_kind or item.channel<>head.channel or item.status<>'queued' or item.attempts<>0
   or item.batch_parent_id is not null or item.batch_payloads is not null
   or coalesce(item.payload->>'fragmentKind','separate') not in ('fragment','continuation','close')
   or item.created_at>head.created_at+interval '10 seconds' or item.created_at>last_at+interval '3 seconds'
   or item.expires_at<=statement_timestamp() or coalesce(array_length(ids,1),0)>=20
   or (head.operation_kind='test' and (item.client_sequence<>head.client_sequence+coalesce(array_length(ids,1),0) or size+length(body)>2000))
  then exit; end if;
  ids:=array_append(ids,item.id);
  payloads:=payloads||jsonb_build_array(case when head.operation_kind='test'
   then item.payload||jsonb_build_object('requestId',item.client_request_id,'sequence',item.client_sequence) else item.payload end);
  size:=size+length(body)+1; last_at:=item.created_at;
  if item.payload->>'fragmentKind'='close' then exit; end if;
 end loop;
 ready_at:=least(head.created_at+interval '10 seconds',last_at+interval '3 seconds');
 if array_length(ids,1)=20 then ready_at:=statement_timestamp(); end if;
 return next;
end $$;
revoke all on function public.workflow_fragment_window(bigint) from public,anon,authenticated;
grant execute on function public.workflow_fragment_window(bigint) to service_role;

create or replace function public.claim_workflow_transport(p_businesses uuid[],p_test_user uuid,p_test_stream uuid,p_fragments boolean) returns setof public.workflow_inbound_queue language plpgsql security definer set search_path=public as $$
declare candidate workflow_inbound_queue; stream text; batch record;
begin
 if p_test_user is null then
  update conversations set status='paused',auto_reply=false where id in(select conversation_id from workflow_inbound_queue where status='sending' and leased_until<now() and (p_businesses is null or business_id=any(p_businesses)));
  update workflow_inbound_queue set status='uncertain',error='Provider result requires reconciliation',leased_until=null where status='sending' and leased_until<now() and (p_businesses is null or business_id=any(p_businesses));
 end if;
 for candidate in select q.* from workflow_inbound_queue q
  where (p_businesses is null or q.business_id=any(p_businesses))
   and ((p_test_user is null and q.operation_kind<>'test') or (q.operation_kind='test' and q.operator_user_id=p_test_user and q.test_stream_id=p_test_stream))
   and (p_fragments is true or (not (q.payload ? 'fragmentKind')
    and not (q.operation_kind='test' and exists(select 1 from workflow_inbound_queue b
     where b.business_id=q.business_id and b.operation_kind='test' and b.operator_user_id=q.operator_user_id
      and b.test_stream_id=q.test_stream_id and b.batch_parent_id is not null))))
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
  if p_fragments is true then
   select * into batch from workflow_fragment_window(candidate.id);
   if batch.ready_at>statement_timestamp() then continue; end if;
   if batch.payloads is not null then
    update workflow_inbound_queue set batch_payloads=batch.payloads where id=candidate.id;
    update workflow_inbound_queue set status='batched',batch_parent_id=candidate.id where id=any(batch.ids) and id<>candidate.id;
   end if;
  end if;
  return query update workflow_inbound_queue set status=case when status='prepared' then 'prepared' else 'processing' end,lease_token=gen_random_uuid(),leased_until=now()+interval '180 seconds',attempts=attempts+1 where id=candidate.id returning *;
  return;
 end loop;
end $$;

revoke all on function public.claim_workflow_transport(uuid[],uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_workflow_transport(uuid[],uuid,uuid,boolean) to service_role;

-- One implementation, with a fail-closed compatibility entry point for old
-- deployments (including existing live-claim wrappers). No worker version may
-- infer compatibility from job age or silently consume only the batch leader.
create or replace function public.claim_workflow_transport(p_businesses uuid[],p_test_user uuid,p_test_stream uuid)
returns setof public.workflow_inbound_queue language sql security definer set search_path=public as $$
 select * from claim_workflow_transport(p_businesses,p_test_user,p_test_stream,false);
$$;
revoke all on function public.claim_workflow_transport(uuid[],uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_workflow_transport(uuid[],uuid,uuid) to service_role;

create or replace function public.workflow_fragment_wait_ms(p_businesses uuid[],p_test_user uuid,p_test_stream uuid)
returns integer language sql stable security definer set search_path=public as $$
 select coalesce(least(3000,greatest(0,ceil(extract(epoch from(min(w.ready_at)-statement_timestamp()))*1000)::integer)),0)
 from workflow_inbound_queue q cross join lateral workflow_fragment_window(q.id) w
 where q.status='queued' and q.attempts=0 and q.batch_parent_id is null
  and (q.leased_until is null or q.leased_until<now()) and (q.expires_at is null or q.expires_at>now())
  and (p_businesses is null or q.business_id=any(p_businesses))
  and ((p_test_user is null and q.operation_kind<>'test') or (q.operation_kind='test' and q.operator_user_id=p_test_user and q.test_stream_id=p_test_stream))
  and not exists(select 1 from workflow_inbound_queue e where e.business_id=q.business_id and e.id<q.id
   and ((q.operation_kind='test' and e.operation_kind='test' and e.operator_user_id=q.operator_user_id and e.test_stream_id=q.test_stream_id)
    or (q.operation_kind<>'test' and e.connection_id=q.connection_id and e.participant_id=q.participant_id))
   and (e.status in ('queued','processing','prepared','sending','uncertain') or q.operation_kind='test' and e.status='failed'));
$$;
revoke all on function public.workflow_fragment_wait_ms(uuid[],uuid,uuid) from public,anon,authenticated;
grant execute on function public.workflow_fragment_wait_ms(uuid[],uuid,uuid) to service_role;
-- Compatibility entry point; the scoped worker uses the same policy above.
create or replace function public.workflow_inbound_batch_wait_ms() returns integer
language sql stable security definer set search_path=public as $$select workflow_fragment_wait_ms(null,null,null)$$;
revoke all on function public.workflow_inbound_batch_wait_ms() from public,anon,authenticated;
grant execute on function public.workflow_inbound_batch_wait_ms() to service_role;
notify pgrst,'reload schema';
commit;
