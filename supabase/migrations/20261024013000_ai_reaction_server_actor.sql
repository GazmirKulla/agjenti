-- Optional server actor in the EXISTING reaction ledger, never an auth user.
-- Local-only, unapplied migration. Default OFF; no business opt-in/backfill.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.businesses add column ai_reactions_enabled boolean not null default false;
alter table public.message_reaction_operations
 alter column user_id drop not null,
 add column actor_kind text not null default 'manual' check(actor_kind in ('manual','ai')),
 add column ai_job_id bigint,
 add column ai_lease_token uuid,
 add column send_started_at timestamptz,
 add constraint reaction_actor_identity check(
  (actor_kind='manual' and user_id is not null and ai_job_id is null and ai_lease_token is null)
  or (actor_kind='ai' and user_id is null and ai_job_id is not null and ai_lease_token is not null));
create unique index reaction_one_ai_attempt on public.message_reaction_operations(reaction_id) where actor_kind='ai';

create function public.reserve_ai_message_reaction(
 p_business uuid,p_conversation uuid,p_message uuid,p_request uuid,p_emoji text,p_job bigint,p_lease uuid
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare c conversations; m messages; r message_reactions; o message_reaction_operations; conn uuid; participant text;
begin
 if p_request is null or p_job is null or p_lease is null or p_emoji is null or p_emoji not in ('❤️','👍','😊','🎉','🙏','😂') then raise exception 'ai_reaction_invalid'; end if;
 select * into c from conversations where id=p_conversation and business_id=p_business;
 select * into m from messages where id=p_message and conversation_id=p_conversation and business_id=p_business and direction='inbound' and source='customer';
 if c.id is null or m.id is null or nullif(m.external_message_id,'') is null then raise exception 'reaction_target_invalid'; end if;
 conn:=coalesce(c.whatsapp_connection_id,c.instagram_connection_id);
 participant:=coalesce(c.whatsapp_participant_id,c.instagram_participant_id);
 perform pg_advisory_xact_lock(hashtextextended(conn::text||':'||m.external_message_id,12));
 select * into o from message_reaction_operations where id=p_request;
 if found then
  select * into r from message_reactions where id=o.reaction_id;
  if o.actor_kind<>'ai' or o.business_id<>p_business or r.message_id<>p_message or o.emoji<>p_emoji then raise exception 'reaction_request_conflict'; end if;
  return jsonb_build_object('claimed',false,'status',o.status);
 end if;
 if c.status<>'active' or not exists(select 1 from businesses b where b.id=p_business and b.ai_reactions_enabled and coalesce(c.auto_reply,b.auto_reply,false))
  then return jsonb_build_object('claimed',false,'reason','disabled'); end if;
 if not exists(select 1 from workflow_inbound_queue q where q.id=p_job and q.lease_token=p_lease and q.leased_until>now()
  and q.status='prepared' and q.operation_kind='inbound' and not q.handoff_requested and q.business_id=p_business and q.conversation_id=p_conversation
  and q.connection_id=conn and q.participant_id=participant and q.channel=c.channel
  and coalesce(q.batch_payloads->-1->>'externalMessageId',q.external_id)=m.external_message_id)
  then return jsonb_build_object('claimed',false,'reason','lease_or_target'); end if;
 insert into message_reactions(business_id,connection_id,channel,participant_id,external_message_id,actor,message_id)
  values(p_business,conn,c.channel,participant,m.external_message_id,'business',m.id) on conflict do nothing;
 select * into r from message_reactions where connection_id=conn and participant_id=participant and external_message_id=m.external_message_id and actor='business' for update;
 -- Any manual intent, including removal or a failed attempt, permanently owns
 -- this target. An AI attempt is never retried, even after a definite rejection.
 if r.message_id is distinct from m.id or r.business_id<>p_business or r.emoji<>'' or r.revision<>0
  or exists(select 1 from message_reaction_operations where reaction_id=r.id)
  then return jsonb_build_object('claimed',false,'reason','existing_ownership'); end if;
 update message_reactions set revision=revision+1,latest_request=p_request where id=r.id returning * into r;
 insert into message_reaction_operations(id,reaction_id,business_id,user_id,actor_kind,ai_job_id,ai_lease_token,emoji,previous_emoji,revision,status)
  values(p_request,r.id,p_business,null,'ai',p_job,p_lease,p_emoji,r.emoji,r.revision,'sending') returning * into o;
 return jsonb_build_object('claimed',true,'id',o.id,'token',o.token,'status',o.status,
  'channel',r.channel,'connectionId',r.connection_id,'participant',r.participant_id,'externalId',r.external_message_id);
end $$;

-- Linearization point immediately before HTTP. Queue -> business -> conversation
-- locks are short/NOWAIT; no DB transaction spans external IO. A takeover that
-- wins before this commit suppresses dispatch; one after it cannot cancel HTTP.
create function public.begin_ai_message_reaction(p_request uuid,p_token uuid,p_account text)
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
  and coalesce(state->>'conversationPaused','false')<>'true' and not (coalesce(state,'{}') ? 'staffHandoff')
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

create or replace function public.reserve_message_reaction(p_business uuid,p_user uuid,p_conversation uuid,p_message uuid,p_request uuid,p_revision integer,p_emoji text,p_retry integer default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c conversations; m messages; r message_reactions; o message_reaction_operations; conn uuid; participant text;
begin
 if not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'reaction_forbidden'; end if;
 if p_request is null or p_revision is null or p_revision<0 or p_emoji is null or p_emoji not in ('','❤️','👍','😊','🎉','🙏','😂') then raise exception 'reaction_invalid'; end if;
 select * into c from conversations where id=p_conversation and business_id=p_business;
 select * into m from messages where id=p_message and conversation_id=p_conversation and business_id=p_business and direction='inbound' and source='customer';
 if c.id is null or m.id is null or nullif(m.external_message_id,'') is null then raise exception 'reaction_target_invalid'; end if;
 conn:=coalesce(c.whatsapp_connection_id,c.instagram_connection_id);participant:=coalesce(c.whatsapp_participant_id,c.instagram_participant_id);
 perform pg_advisory_xact_lock(hashtextextended(conn::text||':'||m.external_message_id,12));
 select * into o from message_reaction_operations where id=p_request for update;
 if found then
  select * into r from message_reactions where id=o.reaction_id for update;
  if o.actor_kind<>'manual' or o.business_id<>p_business or o.user_id is distinct from p_user or r.message_id<>p_message or o.emoji<>p_emoji then raise exception 'reaction_request_conflict'; end if;
  if p_retry is null or o.attempt<>p_retry or o.status<>'failed' then return jsonb_build_object('claimed',false,'status',o.status); end if;
  if o.provider_id is not null or o.attempt>=3 or r.latest_request<>o.id or r.revision<>o.revision then raise exception 'reaction_retry_unsafe'; end if;
 else
  if p_retry is not null then raise exception 'reaction_retry_invalid'; end if;
  insert into message_reactions(business_id,connection_id,channel,participant_id,external_message_id,actor,message_id)
   values(p_business,conn,c.channel,participant,m.external_message_id,'business',m.id) on conflict do nothing;
  -- A current-revision manual intent may supersede AI only BEFORE its dispatch.
  update message_reaction_operations x set status='failed',error='Superseded by manual ownership',finished_at=now()
   from message_reactions y where x.reaction_id=y.id and y.connection_id=conn and y.participant_id=participant
    and y.external_message_id=m.external_message_id and y.actor='business' and y.revision=p_revision
    and x.actor_kind='ai' and x.send_started_at is null and x.status='sending';
  select * into r from message_reactions where connection_id=conn and participant_id=participant and external_message_id=m.external_message_id and actor='business' for update;
  if r.revision<>p_revision or exists(select 1 from message_reaction_operations where reaction_id=r.id and status in ('sending','uncertain')) then raise exception 'reaction_revision_conflict'; end if;
 end if;
 if c.last_inbound_at is null or c.last_inbound_at<now()-interval '24 hours' or m.created_at<now()-interval '30 days' then raise exception 'reaction_window_closed'; end if;
 if c.channel not in ('instagram','whatsapp') or c.channel='whatsapp' and p_emoji='' then raise exception 'reaction_unsupported'; end if;
 if o.id is null then
  update message_reactions set revision=revision+1,latest_request=p_request where id=r.id returning * into r;
  insert into message_reaction_operations(id,reaction_id,business_id,user_id,emoji,previous_emoji,revision,status)
   values(p_request,r.id,p_business,p_user,p_emoji,r.emoji,r.revision,'sending') returning * into o;
 else
  update message_reaction_operations set attempt=attempt+1,token=gen_random_uuid(),status='sending',started_at=now(),finished_at=null,error=null where id=o.id returning * into o;
 end if;
 return jsonb_build_object('claimed',true,'status',o.status,'token',o.token,'channel',r.channel,'connectionId',r.connection_id,'participant',r.participant_id,'externalId',r.external_message_id);
end $$;

-- Lock ACK identity before operation/reaction (same order as webhook receipts).
create or replace function public.finish_message_reaction(p_request uuid,p_token uuid,p_status text,p_external text,p_error text)
returns void language plpgsql security invoker set search_path=public as $$
declare o message_reaction_operations; r message_reactions; early message_transport_receipts;
begin
 select * into o from message_reaction_operations where id=p_request and token=p_token;
 if not found then raise exception 'reaction_attempt_lost'; end if;
 select * into r from message_reactions where id=o.reaction_id;
 if p_external is not null then perform pg_advisory_xact_lock(hashtextextended(r.connection_id::text||':'||p_external,1)); end if;
 perform pg_advisory_xact_lock(hashtextextended(r.connection_id::text||':'||r.external_message_id,12));
 select * into o from message_reaction_operations where id=p_request and token=p_token for update;
 if not found then raise exception 'reaction_attempt_lost'; end if;
 if o.status not in ('sending','uncertain') then return; end if;
 if p_status is null or p_status not in ('sent','failed','uncertain') then raise exception 'reaction_invalid'; end if;
 if o.actor_kind='ai' and o.send_started_at is null and p_status<>'failed' then raise exception 'ai_reaction_not_dispatched'; end if;
 select * into r from message_reactions where id=o.reaction_id for update;
 if p_external is not null then
  select * into early from message_transport_receipts where connection_id=r.connection_id and participant_id=r.participant_id and external_message_id=p_external;
  if early.status='failed' then p_status:='failed';p_error:='Provider rejected reaction'; end if;
  delete from message_transport_receipts where connection_id=r.connection_id and participant_id=r.participant_id and external_message_id=p_external;
 end if;
 update message_reaction_operations set status=p_status,provider_id=p_external,error=p_error,finished_at=now() where id=o.id;
 if p_status='sent' and r.latest_request=o.id and r.revision=o.revision then
  update message_reactions set emoji=o.emoji,occurred_at=now(),ambiguous=false where id=r.id;
 elsif p_status='failed' then
  update message_reactions set emoji=coalesce((select emoji from message_reaction_operations where reaction_id=r.id and status='sent' order by revision desc limit 1),'') where id=r.id;
 end if;
end $$;

create or replace function public.read_message_reactions(p_business uuid,p_user uuid,p_conversation uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
begin
 if not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'reaction_forbidden'; end if;
 if not exists(select 1 from conversations where id=p_conversation and business_id=p_business) then raise exception 'reaction_not_found'; end if;
 perform link_message_reactions(p_business,p_conversation);
 update message_reaction_operations o
 set status=case when o.actor_kind='ai' and o.send_started_at is null then 'failed' else 'uncertain' end,
 error=case when o.actor_kind='ai' and o.send_started_at is null then 'AI reaction expired before dispatch' else 'No authoritative provider result' end
 from message_reactions r join messages m on m.id=r.message_id where o.reaction_id=r.id and m.conversation_id=p_conversation and r.business_id=p_business and o.status='sending' and o.started_at<now()-interval '60 seconds';
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'messageId',r.message_id,'partId',r.part_id,'actor',r.actor,'emoji',r.emoji,'ambiguous',r.ambiguous,'revision',r.revision,
  'requestId',o.id,'requestedEmoji',o.emoji,'status',o.status,'error',o.error,'attempt',o.attempt,
  'canRetry',coalesce(o.actor_kind='manual' and o.user_id=p_user and o.status='failed' and o.provider_id is null and o.attempt<3,false)))
 from message_reactions r join messages m on m.id=r.message_id left join message_reaction_operations o on o.id=r.latest_request
 where r.business_id=p_business and m.business_id=p_business and m.conversation_id=p_conversation
 and m.id in(select id from messages where business_id=p_business and conversation_id=p_conversation order by created_at desc limit 200)),'[]'::jsonb);
end $$;
revoke all on function public.reserve_ai_message_reaction(uuid,uuid,uuid,uuid,text,bigint,uuid),
 public.begin_ai_message_reaction(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_ai_message_reaction(uuid,uuid,uuid,uuid,text,bigint,uuid),
 public.begin_ai_message_reaction(uuid,uuid,text) to service_role;
-- Existing ledger RLS/service-only write ACLs and replaced function ACLs retained.
commit;
