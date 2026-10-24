-- Manual reactions are bounded compare-and-set operations, not chat turns.
-- No conversation/workflow state is written and no transaction spans HTTP.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table public.message_reactions (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 connection_id uuid not null,
 channel text not null,
 participant_id text not null,
 external_message_id text not null,
 actor text not null check(actor in ('customer','business')),
 message_id uuid references public.messages(id) on delete cascade,
 part_id uuid references public.message_transport_parts(id) on delete cascade,
 emoji text not null default '' check(octet_length(emoji)<=64),
 occurred_at timestamptz not null default now(),
 received_at timestamptz not null default now(),
 ambiguous boolean not null default false,
 revision integer not null default 0,
 latest_request uuid,
 unique(connection_id,participant_id,external_message_id,actor),
 foreign key(business_id,connection_id,channel) references public.messaging_connections(business_id,id,channel) on delete cascade
);
create index message_reactions_message on public.message_reactions(message_id);
create index message_reactions_unmatched on public.message_reactions(business_id,connection_id) where message_id is null;
create table public.message_reaction_operations (
 id uuid primary key,
 reaction_id uuid not null references public.message_reactions(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 emoji text not null,
 previous_emoji text not null,
 revision integer not null,
 attempt integer not null default 1 check(attempt between 1 and 3),
 token uuid not null default gen_random_uuid(),
 status text not null check(status in ('sending','sent','failed','uncertain')),
 provider_id text,
 error text,
 started_at timestamptz not null default now(),
 finished_at timestamptz
);
create unique index reaction_one_inflight on public.message_reaction_operations(reaction_id) where status in ('sending','uncertain');
create index reaction_provider_ack on public.message_reaction_operations(provider_id) where provider_id is not null;
alter table public.message_reactions enable row level security;
alter table public.message_reaction_operations enable row level security;
revoke all on public.message_reactions,public.message_reaction_operations from public,anon,authenticated;
grant select on public.message_reactions to authenticated;
grant select,insert,update,delete on public.message_reactions,public.message_reaction_operations to service_role;
create policy reaction_read on public.message_reactions for select to authenticated using(message_id is not null and is_business_member(business_id));

-- Exact provider part wins over the historical last-ID projection.
create function public.link_message_reactions(p_business uuid,p_conversation uuid) returns void
language plpgsql security invoker set search_path=public as $$
begin
 update message_reactions r set message_id=p.message_id,part_id=p.id
 from message_transport_parts p join messages m on m.id=p.message_id join conversations c on c.id=m.conversation_id
 where r.message_id is null and r.business_id=p_business and m.business_id=p_business and c.business_id=p_business and c.id=p_conversation
  and r.actor='customer' and m.direction='outbound' and p.business_id=r.business_id and p.connection_id=r.connection_id
  and p.channel=r.channel and p.participant_id=r.participant_id and p.external_message_id=r.external_message_id;
 update message_reactions r set message_id=m.id from messages m join conversations c on c.id=m.conversation_id
 where r.message_id is null and r.business_id=p_business and m.business_id=p_business and c.business_id=p_business and c.id=p_conversation
  and r.actor='customer' and m.direction='outbound' and m.external_message_id=r.external_message_id
  and r.channel=c.channel and r.connection_id=coalesce(c.whatsapp_connection_id,c.instagram_connection_id)
  and r.participant_id=coalesce(c.whatsapp_participant_id,c.instagram_participant_id)
  and not exists(select 1 from message_transport_parts where message_id=m.id);
end $$;

create function public.record_customer_reaction(p_connection uuid,p_participant text,p_external text,p_emoji text,p_occurred timestamptz)
returns void language plpgsql security invoker set search_path=public as $$
declare c messaging_connections; target uuid;
begin
 if length(p_external) not between 1 and 1024 or length(p_participant) not between 1 and 256 or p_emoji is null or octet_length(p_emoji)>64
  or p_occurred is null or p_occurred>now()+interval '5 minutes' or p_occurred<now()-interval '7 days' then raise exception 'invalid_reaction'; end if;
 select * into c from messaging_connections where id=p_connection;
 if not found then raise exception 'invalid_connection'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_connection::text,11));
 delete from message_reactions where connection_id=p_connection and message_id is null and received_at<now()-interval '7 days';
 if not exists(select 1 from message_reactions where connection_id=p_connection and participant_id=p_participant and external_message_id=p_external and actor='customer')
  and (select count(*) from message_reactions where connection_id=p_connection and message_id is null)>=10000 then raise exception 'reaction_capacity'; end if;
 insert into message_reactions(business_id,connection_id,channel,participant_id,external_message_id,actor,emoji,occurred_at)
 values(c.business_id,c.id,c.channel,p_participant,p_external,'customer',p_emoji,p_occurred)
 on conflict(connection_id,participant_id,external_message_id,actor) do update set
  emoji=case when excluded.occurred_at>message_reactions.occurred_at then excluded.emoji else message_reactions.emoji end,
  ambiguous=case when excluded.occurred_at>message_reactions.occurred_at then false else message_reactions.ambiguous or excluded.emoji<>message_reactions.emoji end,
  occurred_at=greatest(excluded.occurred_at,message_reactions.occurred_at),revision=message_reactions.revision+1
 where excluded.occurred_at>=message_reactions.occurred_at and (excluded.occurred_at>message_reactions.occurred_at or excluded.emoji<>message_reactions.emoji);
 select id into target from conversations where business_id=c.business_id and channel=c.channel
  and coalesce(whatsapp_connection_id,instagram_connection_id)=c.id and coalesce(whatsapp_participant_id,instagram_participant_id)=p_participant;
 if target is not null then perform link_message_reactions(c.business_id,target); end if;
end $$;

create function public.reserve_message_reaction(p_business uuid,p_user uuid,p_conversation uuid,p_message uuid,p_request uuid,p_revision integer,p_emoji text,p_retry integer default null)
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
  if o.business_id<>p_business or o.user_id<>p_user or r.message_id<>p_message or o.emoji<>p_emoji then raise exception 'reaction_request_conflict'; end if;
  if p_retry is null or o.attempt<>p_retry or o.status<>'failed' then return jsonb_build_object('claimed',false,'status',o.status); end if;
  if o.provider_id is not null or o.attempt>=3 or r.latest_request<>o.id or r.revision<>o.revision then raise exception 'reaction_retry_unsafe'; end if;
 else
  if p_retry is not null then raise exception 'reaction_retry_invalid'; end if;
  insert into message_reactions(business_id,connection_id,channel,participant_id,external_message_id,actor,message_id)
   values(p_business,conn,c.channel,participant,m.external_message_id,'business',m.id) on conflict do nothing;
  select * into r from message_reactions where connection_id=conn and participant_id=participant and external_message_id=m.external_message_id and actor='business' for update;
  if r.revision<>p_revision or exists(select 1 from message_reaction_operations where reaction_id=r.id and status in ('sending','uncertain')) then raise exception 'reaction_revision_conflict'; end if;
 end if;
 if c.last_inbound_at is null or c.last_inbound_at<now()-interval '24 hours' or m.created_at<now()-interval '30 days' then raise exception 'reaction_window_closed'; end if;
 -- WA removal stays disabled until the current official contract is verified.
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

create function public.finish_message_reaction(p_request uuid,p_token uuid,p_status text,p_external text,p_error text)
returns void language plpgsql security invoker set search_path=public as $$
declare o message_reaction_operations; r message_reactions; early message_transport_receipts;
begin
 select * into o from message_reaction_operations where id=p_request and token=p_token for update;
 if not found then raise exception 'reaction_attempt_lost'; end if;
 if o.status not in ('sending','uncertain') then return; end if;
 if p_status not in ('sent','failed','uncertain') then raise exception 'reaction_invalid'; end if;
 select * into r from message_reactions where id=o.reaction_id for update;
 if p_external is not null then
  perform pg_advisory_xact_lock(hashtextextended(r.connection_id::text||':'||p_external,1));
  select * into early from message_transport_receipts where connection_id=r.connection_id and participant_id=r.participant_id and external_message_id=p_external;
  if early.status='failed' then p_status:='failed';p_error:='Provider rejected reaction'; end if;
  delete from message_transport_receipts where connection_id=r.connection_id and participant_id=r.participant_id and external_message_id=p_external;
 end if;
 update message_reaction_operations set status=p_status,provider_id=p_external,error=p_error,finished_at=now() where id=o.id;
 if p_status='sent' and r.latest_request=o.id and r.revision=o.revision then
  update message_reactions set emoji=o.emoji,occurred_at=now(),ambiguous=false where id=r.id;
 end if;
end $$;

create function public.record_reaction_receipt(p_connection uuid,p_participant text,p_external text,p_status text) returns boolean
language plpgsql security invoker set search_path=public as $$
declare o message_reaction_operations;
begin
 -- Caller validates signature/time and account. Match account + participant + ACK.
 select x.* into o from message_reaction_operations x join message_reactions r on r.id=x.reaction_id
  where x.provider_id=p_external and r.connection_id=p_connection and r.participant_id=p_participant for update of x;
 if not found then return false; end if;
 if p_status='failed' and o.status='sent' then
  update message_reaction_operations set status='failed',error='Provider rejected reaction',finished_at=now() where id=o.id;
  update message_reactions set emoji=o.previous_emoji where id=o.reaction_id and latest_request=o.id and revision=o.revision;
 end if;
 return true;
end $$;

-- Reuse the existing early receipt buffer and identity lock. This atomic
-- dispatch prevents an ACK/receipt race from stranding a failed reaction.
alter function public.record_transport_receipt(uuid,text,text,text,timestamptz) rename to record_message_transport_receipt;
create function public.record_transport_receipt(p_connection uuid,p_participant text,p_external text,p_status text,p_occurred timestamptz)
returns void language plpgsql security invoker set search_path=public as $$
begin
 if p_status is null or p_status not in ('sent','delivered','read','failed') or p_occurred is null or p_occurred>now()+interval '5 minutes' or p_occurred<now()-interval '7 days' then raise exception 'invalid_receipt'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_connection::text||':'||p_external,1));
 if not record_reaction_receipt(p_connection,p_participant,p_external,p_status) then
  perform record_message_transport_receipt(p_connection,p_participant,p_external,p_status,p_occurred);
 end if;
end $$;

create function public.read_message_reactions(p_business uuid,p_user uuid,p_conversation uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
begin
 if not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'reaction_forbidden'; end if;
 if not exists(select 1 from conversations where id=p_conversation and business_id=p_business) then raise exception 'reaction_not_found'; end if;
 perform link_message_reactions(p_business,p_conversation);
 update message_reaction_operations o set status='uncertain',error='No authoritative provider result'
 from message_reactions r join messages m on m.id=r.message_id where o.reaction_id=r.id and m.conversation_id=p_conversation and r.business_id=p_business and o.status='sending' and o.started_at<now()-interval '60 seconds';
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'messageId',r.message_id,'partId',r.part_id,'actor',r.actor,'emoji',r.emoji,'ambiguous',r.ambiguous,'revision',r.revision,
  'requestId',o.id,'requestedEmoji',o.emoji,'status',o.status,'error',o.error,'attempt',o.attempt,
  'canRetry',o.user_id=p_user and o.status='failed' and o.provider_id is null and o.attempt<3))
 from message_reactions r join messages m on m.id=r.message_id left join message_reaction_operations o on o.id=r.latest_request
 where r.business_id=p_business and m.business_id=p_business and m.conversation_id=p_conversation
 and m.id in(select id from messages where business_id=p_business and conversation_id=p_conversation order by created_at desc limit 200)),'[]'::jsonb);
end $$;
revoke all on function public.link_message_reactions(uuid,uuid),public.record_customer_reaction(uuid,text,text,text,timestamptz),public.reserve_message_reaction(uuid,uuid,uuid,uuid,uuid,integer,text,integer),public.finish_message_reaction(uuid,uuid,text,text,text),public.record_reaction_receipt(uuid,text,text,text),public.read_message_reactions(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.link_message_reactions(uuid,uuid),public.record_customer_reaction(uuid,text,text,text,timestamptz),public.reserve_message_reaction(uuid,uuid,uuid,uuid,uuid,integer,text,integer),public.finish_message_reaction(uuid,uuid,text,text,text),public.record_reaction_receipt(uuid,text,text,text),public.read_message_reactions(uuid,uuid,uuid) to service_role;
revoke all on function public.record_transport_receipt(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_transport_receipt(uuid,text,text,text,timestamptz) to service_role;
commit;
