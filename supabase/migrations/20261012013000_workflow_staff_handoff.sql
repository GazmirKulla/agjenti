-- Preserve the normal staff ownership gate; only the claiming send may pause AI.
-- Apply before the code that requests pausing handoffs. No existing jobs are replayed.
begin;
alter table public.workflow_inbound_queue add column handoff_requested boolean not null default false;
create or replace function public.prepare_workflow_reply(p_id bigint,p_token uuid,p_conversation uuid,p_revision integer,p_state jsonb,p_workflow uuid,p_reply text,p_response text,p_handoff boolean)
returns void language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue; current_revision integer; c conversations; enabled boolean;
begin
 select * into job from workflow_inbound_queue where id=p_id and lease_token=p_token and status='processing' and leased_until>now() for update;
 if not found then raise exception 'lease_lost'; end if;
 select * into c from conversations where id=p_conversation and business_id=job.business_id and channel=job.channel and coalesce(whatsapp_participant_id,instagram_participant_id)=job.participant_id and coalesce(whatsapp_connection_id,instagram_connection_id)=job.connection_id for update;
 if not found then raise exception 'invalid_conversation'; end if;
 select coalesce(c.auto_reply,auto_reply,false) into enabled from businesses where id=job.business_id for update;
 if c.status<>'active' or not enabled then
  update workflow_inbound_queue set status='ignored',conversation_id=p_conversation,leased_until=null,error='Staff controls this conversation' where id=p_id;
  return;
 end if;
 if p_workflow is not null and not exists(select 1 from workflows where id=p_workflow and business_id=job.business_id) then raise exception 'invalid_workflow'; end if;
 select revision into current_revision from conversation_states where conversation_id=p_conversation for update;
 if current_revision is distinct from p_revision then raise exception 'stale_state'; end if;
 update conversation_states set collected=p_state,workflow_id=p_workflow,step_key=p_state->>'step_key',status=case when p_state->>'step_key'='order_ready' then 'ready' else 'in_progress' end,revision=revision+1,updated_at=now() where conversation_id=p_conversation and business_id=job.business_id;
 insert into conversation_profiles(business_id,participant_id,connection_id,channel,profile) values(job.business_id,job.participant_id,job.connection_id,job.channel,coalesce(p_state->'context'->'profile','{}'))
 on conflict(business_id,participant_id,channel) do update set profile=conversation_profiles.profile||excluded.profile,connection_id=excluded.connection_id,updated_at=now();
 update workflow_inbound_queue set status='prepared',conversation_id=p_conversation,reply=p_reply,response_id=p_response,handoff_requested=coalesce(p_handoff,false) where id=p_id;
end $$;

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
 update workflow_inbound_queue set status='sending',leased_until=now()+interval '120 seconds' where id=p_id;
 return true;
end $$;

commit;
