-- The queue is the outbox. Prepared state is retained, never rolled back across
-- booking effects. Delivery receipts are idempotent and require a provider ID.
begin;
alter table public.workflow_inbound_queue add column provider_message_id text, add column send_started_at timestamptz;
create or replace function public.begin_workflow_send(p_id bigint,p_token uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue; c conversations; enabled boolean;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token and status='prepared' and leased_until>now() for update;
 if not found then return false; end if;
 select * into c from conversations where id=job.conversation_id and business_id=job.business_id for update;
 if not found then return false; end if;
 select coalesce(c.auto_reply,auto_reply,false) into enabled from businesses where id=job.business_id;
 if c.status<>'active' or not enabled then
  update workflow_inbound_queue set status='ignored',leased_until=null,error='Staff controls this conversation' where id=p_id;
  return false;
 end if;
 -- Ownership and the one permitted acknowledgement are committed together.
 -- A manual takeover before this point still discards prepared output.
 if job.handoff_requested then
  update conversations set status='paused',auto_reply=false,updated_at=now() where id=c.id;
 end if;
 update workflow_inbound_queue set status='sending',send_started_at=clock_timestamp(),leased_until=now()+interval '120 seconds' where id=p_id;
 return true;
end $$;


create or replace function public.finish_workflow_send(p_id bigint,p_token uuid,p_ok boolean,p_external text,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare job public.workflow_inbound_queue;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token for update;
 if not found then raise exception 'lease_lost'; end if;
 if job.status='sent' then
  if p_ok and p_external is not null and job.provider_message_id=p_external then return; end if;
  raise exception 'receipt_conflict';
 end if;
 if job.status not in ('sending','uncertain') then raise exception 'lease_lost'; end if;
 -- An ambiguous result may be reconciled only with the original lease and an
 -- actual provider receipt. This does not reactivate staff-owned conversations.
 if p_ok and nullif(btrim(p_external),'') is null then raise exception 'receipt_required'; end if;
 if job.status='uncertain' and not p_ok then return; end if;
 perform 1 from conversations where id=job.conversation_id and business_id=job.business_id for update;
 if not found then raise exception 'invalid_conversation'; end if;
 if p_ok then
  insert into messages(business_id,conversation_id,instagram_connection_id,whatsapp_connection_id,direction,source,body,external_message_id,delivery_status,created_at)
   values(job.business_id,job.conversation_id,case when job.channel='instagram' then job.connection_id end,case when job.channel='whatsapp' then job.connection_id end,'outbound','agent',job.reply,p_external,'sent',coalesce(job.send_started_at,job.created_at));
  -- Do not overwrite a newer staff response or a later conversation turn when
  -- reconciling an old receipt after its lease expired.
  if job.status='sending' then
   update conversations set openai_previous_response_id=case when status='active' then job.response_id else null end,last_message_at=now(),last_message_preview=left(job.reply,140) where id=job.conversation_id and (last_message_at is null or last_message_at<=coalesce(job.send_started_at,job.created_at));
  end if;
 else
  update conversations set status='paused',auto_reply=false where id=job.conversation_id;
 end if;
 insert into agent_turns(business_id,conversation_id,status,reply) values(job.business_id,job.conversation_id,case when p_ok then 'ok' else 'failed' end,job.reply);
 update workflow_inbound_queue set status=case when p_ok then 'sent' else 'uncertain' end,provider_message_id=case when p_ok then p_external end,error=case when p_ok then null else p_error end,leased_until=null where id=p_id;
end $$;
commit;
