-- The customer unsent or edited a message on the channel (Instagram `is_deleted` / `message_edit`).
-- A deleted message keeps its row (order, reactions, receipts) but loses its text and media.
-- An edited message shows the customer's latest text. The agent reads `body`, so both carry over.
alter table public.messages add column if not exists customer_deleted_at timestamptz;
alter table public.messages add column if not exists customer_edited_at timestamptz;

-- The provider may report a change before the queued message is stored; the change waits here
-- and is applied when the message arrives. A delete is final: a later edit never restores text.
create table if not exists public.customer_message_changes (
 business_id uuid not null,
 connection_id uuid not null,
 channel text not null,
 participant_id text not null check(length(participant_id) between 1 and 256),
 external_message_id text not null check(length(external_message_id) between 1 and 1024),
 deleted_at timestamptz,
 edited_text text check(edited_text is null or length(edited_text) <= 4096),
 edited_at timestamptz,
 received_at timestamptz not null default now(),
 primary key(connection_id, external_message_id),
 foreign key(business_id,connection_id,channel) references public.messaging_connections(business_id,id,channel) on delete cascade
);
alter table public.customer_message_changes enable row level security;

-- Applies a recorded change to a stored customer message. The participant must match the
-- conversation, so one customer's event can never change another customer's message.
create or replace function public.apply_customer_message_change(p_connection uuid, p_external text)
returns void language plpgsql security invoker set search_path=public as $$
declare ch customer_message_changes; target messages;
begin
 select * into ch from customer_message_changes where connection_id=p_connection and external_message_id=p_external;
 if not found then return; end if;
 select m.* into target from messages m join conversations c on c.id=m.conversation_id and c.business_id=m.business_id
  where m.business_id=ch.business_id and coalesce(m.instagram_connection_id,m.whatsapp_connection_id)=ch.connection_id
   and m.external_message_id=ch.external_message_id and m.direction='inbound' and m.source='customer'
   and coalesce(c.instagram_participant_id,c.whatsapp_participant_id)=ch.participant_id
  for update of m;
 if not found then return; end if;
 if ch.deleted_at is not null then
  update messages set body=null, media=null, customer_deleted_at=coalesce(customer_deleted_at,ch.deleted_at) where id=target.id;
 elsif ch.edited_at is not null and target.customer_deleted_at is null
  and (target.customer_edited_at is null or ch.edited_at>target.customer_edited_at) then
  update messages set body=ch.edited_text, customer_edited_at=ch.edited_at where id=target.id;
 else return;
 end if;
 -- The Inbox preview follows the newest message only.
 if not exists(select 1 from messages n where n.conversation_id=target.conversation_id and n.business_id=target.business_id
   and (n.created_at>target.created_at or n.created_at=target.created_at and n.id>target.id)) then
  update conversations set last_message_preview=case when ch.deleted_at is null then left(ch.edited_text,140) end
   where id=target.conversation_id and business_id=target.business_id;
 end if;
end $$;

create or replace function public.record_customer_message_change(p_connection uuid, p_participant text, p_external text, p_deleted boolean, p_text text, p_occurred timestamptz)
returns void language plpgsql security invoker set search_path=public as $$
declare c messaging_connections;
begin
 if length(p_external) not between 1 and 1024 or length(p_participant) not between 1 and 256 or p_deleted is null
  or (not p_deleted and (p_text is null or length(p_text)>4096))
  or p_occurred is null or p_occurred>now()+interval '5 minutes' or p_occurred<now()-interval '7 days' then raise exception 'invalid_message_change'; end if;
 select * into c from messaging_connections where id=p_connection;
 if not found then raise exception 'invalid_connection'; end if;
 delete from customer_message_changes where connection_id=p_connection and received_at<now()-interval '7 days';
 insert into customer_message_changes(business_id,connection_id,channel,participant_id,external_message_id,deleted_at,edited_text,edited_at)
 values(c.business_id,c.id,c.channel,p_participant,p_external,
  case when p_deleted then p_occurred end, case when not p_deleted then p_text end, case when not p_deleted then p_occurred end)
 on conflict(connection_id,external_message_id) do update set
  deleted_at=coalesce(customer_message_changes.deleted_at,excluded.deleted_at),
  edited_text=case when customer_message_changes.deleted_at is not null or excluded.deleted_at is not null then null
   when excluded.edited_at>coalesce(customer_message_changes.edited_at,'-infinity') then excluded.edited_text else customer_message_changes.edited_text end,
  edited_at=greatest(customer_message_changes.edited_at,excluded.edited_at)
 -- The same participant only; a forged event for someone else's message id changes nothing.
 where customer_message_changes.participant_id=excluded.participant_id;
 perform apply_customer_message_change(p_connection,p_external);
end $$;

-- A change that arrived first is applied when the customer message is stored.
create or replace function public.messages_apply_pending_customer_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.direction='inbound' and new.source='customer' and new.external_message_id is not null
  and exists(select 1 from customer_message_changes where connection_id=coalesce(new.instagram_connection_id,new.whatsapp_connection_id)
   and external_message_id=new.external_message_id) then
  perform apply_customer_message_change(coalesce(new.instagram_connection_id,new.whatsapp_connection_id),new.external_message_id);
 end if;
 return null;
end $$;
drop trigger if exists messages_apply_pending_customer_change on public.messages;
create trigger messages_apply_pending_customer_change after insert on public.messages
 for each row execute function public.messages_apply_pending_customer_change();

revoke all on function public.apply_customer_message_change(uuid,text),
 public.record_customer_message_change(uuid,text,text,boolean,text,timestamptz),
 public.messages_apply_pending_customer_change() from public,anon,authenticated;
grant execute on function public.apply_customer_message_change(uuid,text),
 public.record_customer_message_change(uuid,text,text,boolean,text,timestamptz) to service_role;
