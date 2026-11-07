begin;

-- Ownership changes invalidate prompts and approvals, never facts or uncertain receipts.
create function public.suspend_process_ownership(p_state jsonb,p_revision integer)
returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare result jsonb; instances jsonb := '{}'::jsonb; item record; instance jsonb; status text;
begin
  if p_state->>'schemaVersion' is distinct from '4' or jsonb_typeof(p_state->'instances') is distinct from 'object'
    then raise exception 'state_invalid'; end if;
  result:=(p_state-'pendingTurn'-'handoffRequested') || jsonb_build_object('revision',p_revision,'focusId',null,'offers','{}'::jsonb);
  for item in select key,value from jsonb_each(p_state->'instances') loop
    instance:=item.value; status:=instance->>'status';
    if instance#>>'{action,status}' in ('running','unknown') then
      -- A provider may have committed. Recovery must inspect its receipt before progressing.
      instance:=instance || jsonb_build_object('status','waiting_effect');
    elsif status='handoff' then
      instance:=(instance-'wait'-'approval'-'suspendedStatus') || jsonb_build_object('status','completed');
    elsif status not in ('completed','cancelled','failed') then
      if instance#>>'{action,status}'='prepared' then
        if instance#>>'{action,approval,stepId}' is not null then
          instance:=jsonb_set(instance,'{stepId}',instance#>'{action,approval,stepId}');
          instance:=instance-'action';
        else
          instance:=(instance-'wait'-'approval'-'suspendedStatus') || jsonb_build_object('status','failed','lastError','ownership_changed');
          instance:=jsonb_set(instance,'{action,status}','"failed"'::jsonb);
        end if;
      end if;
      if instance->>'status'<>'failed' then
        instance:=(instance-'wait'-'approval') || jsonb_build_object('status','suspended','suspendedStatus','running');
      end if;
    end if;
    instances:=instances || jsonb_build_object(item.key,instance);
  end loop;
  return jsonb_set(result,'{instances}',instances);
end $$;

create function public.invalidate_process_ownership()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  update public.conversation_states set collected=public.suspend_process_ownership(collected,revision+1),
    revision=revision+1,updated_at=now()
    where conversation_id=new.id and business_id=new.business_id and collected->>'schemaVersion'='4';
  return new;
end $$;
create trigger invalidate_process_ownership after update of status,auto_reply on public.conversations
for each row when ((new.status is distinct from old.status or new.auto_reply is distinct from old.auto_reply)
  and (new.status<>'active' or new.auto_reply is false)) execute function public.invalidate_process_ownership();

create or replace function public.resume_conversation_agent(p_business uuid,p_user uuid,p_conversation uuid,p_revision integer)
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
  update public.workflow_inbound_queue set status='ignored',leased_until=null,
    error='Staff resumed the agent',reply=null where id=any(jobs) and status in ('queued','processing','prepared');
  get diagnostics changed = row_count;
  if changed<>coalesce(cardinality(jobs),0) then raise exception 'queue_transition_conflict'; end if;
  update public.conversations set status='active',auto_reply=true,updated_at=now()
    where id=p_conversation and business_id=p_business;
  if not found then raise exception 'invalid_conversation'; end if;
  return p_revision+1;
end $$;

revoke all on function public.suspend_process_ownership(jsonb,integer),public.invalidate_process_ownership() from public,anon,authenticated,service_role;
revoke all on function public.resume_conversation_agent(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.resume_conversation_agent(uuid,uuid,uuid,integer) to service_role;
commit;
