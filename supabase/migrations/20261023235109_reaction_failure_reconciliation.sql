-- A late failure must never restore a predecessor that has itself failed.
-- Forward-only correction to the separately staged reactions feature.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create index reaction_confirmed_revision on public.message_reaction_operations(reaction_id,revision desc) where status='sent';

create or replace function public.finish_message_reaction(p_request uuid,p_token uuid,p_status text,p_external text,p_error text)
returns void language plpgsql security invoker set search_path=public as $$
declare o message_reaction_operations; r message_reactions; early message_transport_receipts;
begin
 select * into o from message_reaction_operations where id=p_request and token=p_token for update;
 if not found then raise exception 'reaction_attempt_lost'; end if;
 if o.status not in ('sending','uncertain') then return; end if;
 if p_status is null or p_status not in ('sent','failed','uncertain') then raise exception 'reaction_invalid'; end if;
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
 elsif p_status='failed' then
  update message_reactions set emoji=coalesce((select emoji from message_reaction_operations where reaction_id=r.id and status='sent' order by revision desc limit 1),'') where id=r.id;
 end if;
end $$;

create or replace function public.record_reaction_receipt(p_connection uuid,p_participant text,p_external text,p_status text) returns boolean
language plpgsql security invoker set search_path=public as $$
declare o message_reaction_operations;
begin
 select x.* into o from message_reaction_operations x join message_reactions r on r.id=x.reaction_id
  where x.provider_id=p_external and r.connection_id=p_connection and r.participant_id=p_participant for update of x;
 if not found then return false; end if;
 if p_status='failed' and o.status='sent' then
  -- Use the same operation -> reaction lock order as reserve/finish.
  perform 1 from message_reactions where id=o.reaction_id for update;
  update message_reaction_operations set status='failed',error='Provider rejected reaction',finished_at=now() where id=o.id;
  update message_reactions set emoji=coalesce((select emoji from message_reaction_operations where reaction_id=o.reaction_id and status='sent' order by revision desc limit 1),'') where id=o.reaction_id;
 end if;
 return true;
end $$;
-- CREATE OR REPLACE preserves the service-only ACL of both functions.
commit;
