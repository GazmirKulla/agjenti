-- Forward-only correction: a workflow pause after an acknowledgement is not
-- staff ownership. Keep real conversation policy, handoff, lease and revision gates.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if to_regprocedure('public.begin_ai_message_reaction(uuid,uuid,text)') is null then
  raise exception 'ai_reaction_server_actor_migration_required';
 end if;
end $$;
create or replace function public.begin_ai_message_reaction(p_request uuid,p_token uuid,p_account text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare o message_reaction_operations; r message_reactions; q workflow_inbound_queue;
 c conversations; b businesses; m messages; state jsonb; valid boolean:=false;
begin
 select * into o from message_reaction_operations where id=p_request and token=p_token and actor_kind='ai';
 if not found then return false; end if;
 select * into r from message_reactions where id=o.reaction_id;
 perform pg_advisory_xact_lock(hashtextextended(r.connection_id::text||':'||r.external_message_id,12));
 select * into q from workflow_inbound_queue where id=o.ai_job_id for share nowait;
 select * into b from businesses where id=o.business_id for share nowait;
 select * into c from conversations where id=q.conversation_id and business_id=o.business_id for share nowait;
 select * into m from messages where id=r.message_id and business_id=o.business_id and conversation_id=c.id for share nowait;
 select collected into state from conversation_states where conversation_id=c.id and business_id=o.business_id for share nowait;
 select * into o from message_reaction_operations where id=p_request and token=p_token and actor_kind='ai' for update;
 select * into r from message_reactions where id=o.reaction_id for update;
 if o.status<>'sending' or o.send_started_at is not null then return false; end if;
 valid:=coalesce(
  b.ai_reactions_enabled and coalesce(c.auto_reply,b.auto_reply,false) and c.status='active'
  and q.id is not null and q.lease_token=o.ai_lease_token and q.leased_until>clock_timestamp()
  and q.status='prepared' and q.operation_kind='inbound' and not q.handoff_requested and q.business_id=b.id
  and q.connection_id=r.connection_id and q.channel=r.channel and q.participant_id=r.participant_id
  and coalesce(q.batch_payloads->-1->>'externalMessageId',q.external_id)=r.external_message_id
  and c.channel=r.channel and coalesce(c.whatsapp_connection_id,c.instagram_connection_id)=r.connection_id
  and coalesce(c.whatsapp_participant_id,c.instagram_participant_id)=r.participant_id
  and m.id is not null and m.direction='inbound' and m.source='customer' and m.external_message_id=r.external_message_id
  and coalesce(m.whatsapp_connection_id,m.instagram_connection_id)=r.connection_id
  and m.created_at>now()-interval '30 days' and c.last_inbound_at>now()-interval '24 hours'
  and not (coalesce(state,'{}') ? 'staffHandoff')
  and not (coalesce(state#>>'{visual,status}','')='handoff' and coalesce(state#>>'{visual,advisory}','false')<>'true')
  and r.latest_request=o.id and r.revision=o.revision
  and not exists(select 1 from message_reaction_operations where reaction_id=r.id and actor_kind='manual'),false);
 if valid then
  if r.channel='instagram' then
   perform 1 from instagram_connections where id=r.connection_id and business_id=b.id and ig_user_id=p_account and status='connected' for share nowait;
  elsif r.channel='whatsapp' then
   perform 1 from whatsapp_connections where id=r.connection_id and business_id=b.id and phone_number_id=p_account and status='connected' for share nowait;
  else return false;
  end if;
  valid:=found;
 end if;
 if not valid then
  update message_reaction_operations set status='failed',error='Fresh AI reaction guard rejected',finished_at=now() where id=o.id;
  return false;
 end if;
 update message_reaction_operations set send_started_at=clock_timestamp() where id=o.id;
 return true;
end $$;
-- CREATE OR REPLACE preserves the service-only ACL and SECURITY INVOKER.
commit;
