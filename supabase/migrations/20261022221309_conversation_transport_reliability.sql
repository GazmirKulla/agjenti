-- Package 1: transport ownership only. Deploy this migration before the caller.
-- No replay, business-data backfill, graph changes or delivery-receipt deletion.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Resolve ONLY persisted identity: an existing association or the exact inbound
-- receipt. Participant equality alone is never evidence of conversation identity.
create function public.workflow_inbound_original_conversation(p_job public.workflow_inbound_queue)
returns uuid language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select c.id from public.conversations c
  where c.business_id=p_job.business_id and c.channel=p_job.channel
    and coalesce(c.whatsapp_connection_id,c.instagram_connection_id)=p_job.connection_id
    and coalesce(c.whatsapp_participant_id,c.instagram_participant_id)=p_job.participant_id
    and (c.id=p_job.conversation_id or (p_job.conversation_id is null and exists(
      select 1 from public.messages m where m.business_id=p_job.business_id
        and m.conversation_id=c.id and m.external_message_id=p_job.external_id
        and m.direction='inbound' and m.source='customer'
        and coalesce(m.whatsapp_connection_id,m.instagram_connection_id)=p_job.connection_id
    )))
  -- Fail closed if corrupt/ambiguous receipts ever identify multiple threads.
  and (p_job.conversation_id is not null or 1=(select count(distinct m.conversation_id)
    from public.messages m where m.business_id=p_job.business_id
      and m.external_message_id=p_job.external_id and m.direction='inbound' and m.source='customer'
      and coalesce(m.whatsapp_connection_id,m.instagram_connection_id)=p_job.connection_id));
$$;

-- Older server deployments still call prepare_workflow_reply directly. Its
-- final queue update must not move an old job (or its effects) to another thread.
create function public.protect_workflow_conversation_binding()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare original uuid;
begin
  original:=coalesce(old.conversation_id,public.workflow_inbound_original_conversation(old));
  if original is not null and original is distinct from new.conversation_id then
    raise exception 'conversation_binding_conflict';
  end if;
  if new.conversation_id is not null and public.workflow_inbound_original_conversation(new) is distinct from new.conversation_id then
    raise exception 'invalid_conversation';
  end if;
  return new;
end $$;
create trigger protect_workflow_conversation_binding
before update of conversation_id on public.workflow_inbound_queue for each row
when (old.conversation_id is distinct from new.conversation_id)
execute function public.protect_workflow_conversation_binding();

create function public.bind_workflow_inbound(p_id bigint,p_token uuid,p_conversation uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare j public.workflow_inbound_queue; original uuid;
begin
  select * into j from public.workflow_inbound_queue where id=p_id and lease_token=p_token
    and status='processing' and leased_until>now() for update;
  if not found then raise exception 'lease_lost'; end if;
  original:=public.workflow_inbound_original_conversation(j);
  if (j.conversation_id is not null and j.conversation_id is distinct from p_conversation)
    or (original is not null and original is distinct from p_conversation) then
    raise exception 'conversation_binding_conflict';
  end if;
  perform 1 from public.conversations c where c.id=p_conversation and c.business_id=j.business_id
    and c.channel=j.channel and coalesce(c.whatsapp_connection_id,c.instagram_connection_id)=j.connection_id
    and coalesce(c.whatsapp_participant_id,c.instagram_participant_id)=j.participant_id for key share;
  if not found then raise exception 'invalid_conversation'; end if;
  update public.workflow_inbound_queue set conversation_id=p_conversation where id=j.id;
  if not found then raise exception 'conversation_binding_conflict'; end if;
  return true;
end $$;

-- Existing claim functions already mark exhausted jobs failed. Keep their claim,
-- retry, batching and receipt behavior; repair only the original-thread boundary.
create function public.pause_exhausted_workflow_conversation()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare original uuid;
begin
  original:=public.workflow_inbound_original_conversation(new);
  if original is null then
    update public.workflow_inbound_queue
      set error='Processing retries exhausted; original conversation unverified; staff review required'
      where id=new.id;
    return new;
  end if;
  if new.conversation_id is null then
    update public.workflow_inbound_queue set conversation_id=original where id=new.id;
  end if;
  update public.conversations set status='paused',auto_reply=false,updated_at=now()
    where id=original and business_id=new.business_id and status='active';
  return new;
end $$;
create trigger pause_exhausted_workflow_conversation
after update of status on public.workflow_inbound_queue for each row
when (new.status='failed' and old.status is distinct from new.status)
execute function public.pause_exhausted_workflow_conversation();

create function public.resume_conversation_agent(p_business uuid,p_user uuid,p_conversation uuid,p_revision integer)
returns integer language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare c public.conversations; s public.conversation_states; next_state jsonb; jobs bigint[]; locked_jobs bigint[]; changed integer;
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
  -- Do not discard receipts or claim a provider request can be cancelled.
  if exists(select 1 from public.workflow_inbound_queue where id=any(jobs) and status in ('sending','uncertain')) then
    raise exception 'delivery_unverified';
  end if;
  next_state:=s.collected;
  if jsonb_typeof(next_state) is distinct from 'object' then raise exception 'state_invalid'; end if;
  next_state:=jsonb_set(next_state-'staffHandoff','{conversationPaused}','false');
  if next_state#>>'{visual,status}'='handoff' and coalesce(next_state#>>'{visual,advisory}','false')<>'true' then
    next_state:=jsonb_set(next_state,'{completedVisual}',next_state->'visual');
    next_state:=jsonb_set(next_state,'{visual,status}','"completed"');
  end if;
  if jsonb_typeof(next_state->'processes')='object' then
    next_state:=jsonb_set(next_state,'{processes}',
      ((next_state->'processes') - 'pendingChoice'::text - 'auxiliary'::text)||'{"active":null,"promptOwner":null}'::jsonb);
  end if;
  update public.conversation_states set collected=next_state,revision=revision+1,updated_at=now()
    where conversation_id=p_conversation and business_id=p_business and revision=p_revision;
  if not found then raise exception 'stale_state'; end if;
  update public.workflow_inbound_queue set status='ignored',leased_until=null,
    error='Staff resumed the agent',reply=null where id=any(jobs) and status in ('queued','processing','prepared');
  get diagnostics changed = row_count;
  if changed<>coalesce(cardinality(jobs),0) then raise exception 'queue_transition_conflict'; end if;
  update public.conversations set status='active',auto_reply=true,updated_at=now()
    where id=p_conversation and business_id=p_business;
  if not found then raise exception 'invalid_conversation'; end if;
  return p_revision+1;
end $$;

revoke all on function public.workflow_inbound_original_conversation(public.workflow_inbound_queue),
  public.protect_workflow_conversation_binding(),public.pause_exhausted_workflow_conversation(),public.bind_workflow_inbound(bigint,uuid,uuid),
  public.resume_conversation_agent(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.bind_workflow_inbound(bigint,uuid,uuid),
  public.resume_conversation_agent(uuid,uuid,uuid,integer) to service_role;
commit;
