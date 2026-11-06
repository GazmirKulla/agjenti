-- Process checkpoint and panel transcript share one transaction, including delivery.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function public.finish_process_panel_chat(
 p_id bigint,p_token uuid,p_revision integer,p_state jsonb,p_event text,p_event_hash text,
 p_reply text,p_targets jsonb,p_result text,p_handoff boolean default false
) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.workflow_inbound_queue; receipt jsonb;
begin
 select * into j from public.workflow_inbound_queue where id=p_id and lease_token=p_token and operation_kind='panel' for update;
 if not found then raise exception 'lease_lost'; end if;
 if not public.can_use_panel_chat(j.business_id,j.operator_user_id) then raise exception 'panel_forbidden'; end if;
 if j.status='sent' then
  if not exists(select 1 from public.process_event_receipts where business_id=j.business_id and conversation_id=j.conversation_id
   and event_id=p_event and event_hash=p_event_hash and job_id=j.id) then raise exception 'event_conflict'; end if;
  return;
 end if;
 if p_result is null or length(p_result)>2000000 then raise exception 'panel_invalid_result'; end if;
 receipt:=public.commit_process_checkpoint(j.business_id,j.conversation_id,j.id,p_token,p_event,p_event_hash,p_revision,p_state,p_reply,p_targets);
 if (receipt->>'replayed')::boolean then raise exception 'unexpected_panel_checkpoint'; end if;
 insert into public.messages(business_id,conversation_id,direction,source,body,delivery_status)
 values(j.business_id,j.conversation_id,'inbound','customer',j.payload->>'message',null),
 (j.business_id,j.conversation_id,'outbound','agent',p_reply,'sent');
 update public.conversations set last_message_at=now(),last_inbound_at=now(),last_message_preview=left(p_reply,180),openai_previous_response_id=null,
 status=case when p_handoff then 'paused' else status end,auto_reply=not p_handoff,updated_at=now()
 where id=j.conversation_id and business_id=j.business_id;
 -- The delivery trigger updates only current, unexpired process targets.
 update public.workflow_inbound_queue set status='sent',result_ciphertext=p_result,leased_until=null,error=null where id=j.id;
end $$;
revoke all on function public.finish_process_panel_chat(bigint,uuid,integer,jsonb,text,text,text,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.finish_process_panel_chat(bigint,uuid,integer,jsonb,text,text,text,jsonb,text,boolean) to service_role;
commit;
