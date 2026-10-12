-- Keep conversation identity, messaging window and workflow state intact.
-- Clear the history and its list preview together, or roll back both on error.
create function public.clear_conversation_messages(p_business_id uuid, p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform 1 from conversations
    where id = p_conversation_id and business_id = p_business_id for update;
  if not found then return false; end if;

  delete from messages
    where conversation_id = p_conversation_id and business_id = p_business_id;
  update conversations
    set last_message_preview = null, unread_count = 0,
        openai_previous_response_id = null, updated_at = now()
    where id = p_conversation_id and business_id = p_business_id;
  return true;
end;
$$;

revoke all on function public.clear_conversation_messages(uuid, uuid) from public, anon, authenticated;
grant execute on function public.clear_conversation_messages(uuid, uuid) to service_role;
