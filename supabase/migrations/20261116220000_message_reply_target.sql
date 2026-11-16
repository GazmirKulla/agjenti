-- What a customer message replies to, as the channel reported it: another message (`mid`) or the
-- business's story (`story`: id and a short-lived media link). Display only; the agent input is unchanged.
alter table public.messages add column if not exists reply_to jsonb;
alter table public.messages drop constraint if exists messages_reply_to_shape;
alter table public.messages add constraint messages_reply_to_shape
  check (reply_to is null or (jsonb_typeof(reply_to)='object' and octet_length(reply_to::text)<=4096));

-- Unsent messages also lose the story link they replied to.
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
  update messages set body=null, media=null, reply_to=null, customer_deleted_at=coalesce(customer_deleted_at,ch.deleted_at) where id=target.id;
 elsif ch.edited_at is not null and target.customer_deleted_at is null
  and (target.customer_edited_at is null or ch.edited_at>target.customer_edited_at) then
  update messages set body=ch.edited_text, customer_edited_at=ch.edited_at where id=target.id;
 else return;
 end if;
 if not exists(select 1 from messages n where n.conversation_id=target.conversation_id and n.business_id=target.business_id
   and (n.created_at>target.created_at or n.created_at=target.created_at and n.id>target.id)) then
  update conversations set last_message_preview=case when ch.deleted_at is null then left(ch.edited_text,140) end
   where id=target.conversation_id and business_id=target.business_id;
 end if;
end $$;
revoke all on function public.apply_customer_message_change(uuid,text) from public,anon,authenticated;
grant execute on function public.apply_customer_message_change(uuid,text) to service_role;
