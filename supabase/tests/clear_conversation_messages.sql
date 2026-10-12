begin;
do $$
declare
  b uuid := gen_random_uuid();
  other_b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  other_c uuid := gen_random_uuid();
begin
  insert into businesses(id, name, slug) values
    (b, 'Clear history test', 'clear-history-test'),
    (other_b, 'Other business', 'clear-history-other');
  insert into conversations(id, business_id, status, auto_reply, last_message_preview, unread_count, last_inbound_at)
    values (c, b, 'paused', false, 'Old message', 2, now()),
           (other_c, other_b, 'active', true, 'Keep this', 1, now());
  insert into conversation_states(conversation_id, business_id) values(c, b);
  insert into messages(business_id, conversation_id, direction, source, body) values
    (b, c, 'inbound', 'customer', 'Hello'),
    (b, c, 'outbound', 'staff', 'Hi'),
    (other_b, other_c, 'inbound', 'customer', 'Keep this');

  if clear_conversation_messages(other_b, c) then raise exception 'Cross-tenant clear allowed'; end if;
  if (select count(*) from messages where conversation_id = c) <> 2 then raise exception 'Cross-tenant messages changed'; end if;
  if not clear_conversation_messages(b, c) then raise exception 'Clear failed'; end if;
  if exists(select 1 from messages where conversation_id = c) then raise exception 'Messages remain'; end if;
  if not exists(select 1 from conversations where id = c and status = 'paused' and auto_reply = false
    and last_inbound_at is not null and last_message_preview is null and unread_count = 0) then
    raise exception 'Conversation identity, status or messaging window changed';
  end if;
  if not exists(select 1 from conversation_states where conversation_id = c) then raise exception 'Workflow state deleted'; end if;
  if not exists(select 1 from messages where conversation_id = other_c) then raise exception 'Other history deleted'; end if;
  if not clear_conversation_messages(b, c) then raise exception 'Repeated clear failed'; end if;

  insert into messages(business_id, conversation_id, direction, source, body) values(b, c, 'inbound', 'customer', 'New message');
  if (select count(*) from messages where conversation_id = c) <> 1 then raise exception 'Cannot continue conversation'; end if;
  if has_function_privilege('authenticated', 'clear_conversation_messages(uuid,uuid)', 'execute')
    or has_function_privilege('anon', 'clear_conversation_messages(uuid,uuid)', 'execute') then
    raise exception 'Clear RPC exposed';
  end if;
end $$;
rollback;
