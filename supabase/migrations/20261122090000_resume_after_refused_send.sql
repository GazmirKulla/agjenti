-- Resuming the agent no longer stays blocked by a message the channel refused outright (e.g. Meta rejected
-- the token): every part of it failed and none has a provider id, so it reached nobody. Such a send is
-- settled as failed (its receipt and error stay) and the resume goes on. A send still in flight, or one
-- whose result is truly unknown, still blocks: nothing is ever resent or assumed delivered.
--
-- Rollback: re-run the resume_conversation_agent definition of 20261107010000_process_ownership.sql.
begin;
set local lock_timeout='5s';

create or replace function public.resume_conversation_agent(p_business uuid,p_user uuid,p_conversation uuid,p_revision integer)
returns integer language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare c public.conversations; s public.conversation_states; next_state jsonb; jobs bigint[]; locked_jobs bigint[]; changed integer; settled bigint[];
begin
  -- Only a trusted server can supply p_user; still reauthorize membership here.
  perform 1 from public.platform_admins where user_id=p_user for share;
  if not found then
    perform 1 from public.business_users where user_id=p_user and business_id=p_business for share;
    if not found then raise exception 'unauthorized'; end if;
  end if;
  select * into c from public.conversations where id=p_conversation and business_id=p_business;
  if not found then raise exception 'invalid_conversation'; end if;
  -- Queue -> conversation -> state matches worker ordering. NOWAIT rejects busy
  -- ownership transitions instead of risking an inverse-lock deadlock elsewhere.
  select array_agg(locked.id) into locked_jobs from (select q.id from public.workflow_inbound_queue q where q.business_id=p_business
    and (q.conversation_id=p_conversation or (q.connection_id=coalesce(c.whatsapp_connection_id,c.instagram_connection_id)
      and q.participant_id=coalesce(c.whatsapp_participant_id,c.instagram_participant_id) and q.channel=c.channel))
    and q.status in ('queued','processing','prepared','sending','uncertain') order by q.id for update nowait) locked;
  select array_agg(q.id) into jobs from public.workflow_inbound_queue q
    where q.id=any(locked_jobs) and q.business_id=p_business and q.status in ('queued','processing','prepared','sending','uncertain')
      and public.workflow_inbound_original_conversation(q)=p_conversation;
  select * into c from public.conversations where id=p_conversation and business_id=p_business for update nowait;
  if not found then raise exception 'invalid_conversation'; end if;
  select * into s from public.conversation_states where conversation_id=p_conversation and business_id=p_business for update nowait;
  if not found then raise exception 'state_missing'; end if;
  if p_revision is null or s.revision is distinct from p_revision then raise exception 'stale_state'; end if;
  -- A send the channel refused outright (every part failed, none with a provider id) reached nobody: it is
  -- settled as failed, its receipt kept. Only a send still in flight or truly unknown blocks the resume.
  select array_agg(q.id) into settled from public.workflow_inbound_queue q
    where q.id=any(jobs) and q.status='uncertain'
      and exists(select 1 from public.message_transport_parts p where p.job_id=q.id)
      and (select count(*) from public.message_transport_parts p where p.job_id=q.id)=(select max(p.part_count) from public.message_transport_parts p where p.job_id=q.id)
      and not exists(select 1 from public.message_transport_parts p where p.job_id=q.id and (p.status<>'failed' or p.external_message_id is not null));
  -- Do not discard receipts or claim a provider request can be cancelled.
  if exists(select 1 from public.workflow_inbound_queue where id=any(jobs) and status in ('sending','uncertain') and not (id=any(coalesce(settled,'{}')))) then
    raise exception 'delivery_unverified';
  end if;
  next_state:=s.collected;
  if jsonb_typeof(next_state) is distinct from 'object' then raise exception 'state_invalid'; end if;
  -- Pre-production reset authorized for old process cursors. Messages and domain
  -- records remain separate; no old proposal becomes an approval in the new engine.
  if next_state->>'schemaVersion' is null or next_state->>'schemaVersion' in ('1','2','3') then
    next_state:=jsonb_build_object('schemaVersion',4,'mode','live','businessId',p_business,
      'conversationId',p_conversation,'revision',p_revision,'instances','{}'::jsonb,'offers','{}'::jsonb,'focusId',null);
  end if;
  if next_state->>'schemaVersion' is distinct from '4' or next_state->>'mode' is distinct from 'live'
    or next_state->>'businessId' is distinct from p_business::text or next_state->>'conversationId' is distinct from p_conversation::text
    or (next_state->>'revision')::integer is distinct from p_revision then raise exception 'state_invalid'; end if;
  next_state:=public.suspend_process_ownership(next_state,p_revision+1);
  update public.conversation_states set collected=next_state,revision=revision+1,updated_at=now()
    where conversation_id=p_conversation and business_id=p_business and revision=p_revision;
  if not found then raise exception 'stale_state'; end if;
  update public.workflow_inbound_queue set status='failed',leased_until=null where id=any(coalesce(settled,'{}')) and status='uncertain';
  get diagnostics changed = row_count;
  if changed<>coalesce(cardinality(settled),0) then raise exception 'queue_transition_conflict'; end if;
  update public.workflow_inbound_queue set status='ignored',leased_until=null,
    error='Staff resumed the agent',reply=null where id=any(jobs) and status in ('queued','processing','prepared');
  get diagnostics changed = row_count;
  if changed<>coalesce(cardinality(jobs),0)-coalesce(cardinality(settled),0) then raise exception 'queue_transition_conflict'; end if;
  update public.conversations set status='active',auto_reply=true,updated_at=now()
    where id=p_conversation and business_id=p_business;
  if not found then raise exception 'invalid_conversation'; end if;
  return p_revision+1;
end $$;

revoke all on function public.resume_conversation_agent(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.resume_conversation_agent(uuid,uuid,uuid,integer) to service_role;
commit;
