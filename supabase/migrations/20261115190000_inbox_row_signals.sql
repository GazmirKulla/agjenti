-- What the Inbox list shows about each conversation, read for one page at a time.
-- conversations.unread_count is set on every customer message and never cleared
-- by a reply, so it cannot say whether the business answered. This reads the
-- answer from the messages themselves: any delivered agent or staff reply counts,
-- including replies sent from the Instagram / WhatsApp app (provider echoes) and
-- imported history. Failed and not-yet-sent replies do not count.
--
-- Contact flags are format checks (a phone-like run of 9+ digits, an email
-- address) over the customer's own messages, plus the validated phone/email the
-- agent collected and the linked customer's phone. They never read intent.
--
-- Every row is scoped to p_business; foreign or unknown ids return nothing.
-- Additive and read-only: rolling back is `drop function public.inbox_row_signals(uuid, uuid[])`.

create or replace function public.inbox_row_signals(p_business uuid, p_conversations uuid[])
returns table (
  conversation_id uuid,
  last_customer_at timestamptz,
  last_reply_at timestamptz,
  has_phone boolean,
  has_email boolean,
  order_count integer,
  lead_status text,
  customer_linked boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    c.id,
    inbound.at,
    reply.at,
    coalesce(nullif(btrim(cu.phone), '') is not null, false)
      or coalesce(p.profile -> 'phone' ->> 'validated' = 'true', false)
      or exists (
        select 1 from messages m
        cross join lateral regexp_matches(coalesce(m.body, ''), '\+?\d[\d\s().-]{7,}\d', 'g') as found(parts)
        where m.conversation_id = c.id and m.business_id = p_business
          and m.direction = 'inbound' and m.source = 'customer'
          and length(regexp_replace(found.parts[1], '\D', '', 'g')) >= 9),
    coalesce(p.profile -> 'email' ->> 'validated' = 'true', false)
      or exists (
        select 1 from messages m
        where m.conversation_id = c.id and m.business_id = p_business
          and m.direction = 'inbound' and m.source = 'customer'
          and m.body ~ '[[:alnum:]_.+-]+@[[:alnum:]_-]+(\.[[:alnum:]_-]+)+'),
    (select count(*)::integer from orders o
      where o.business_id = p_business and o.status not in ('draft', 'failed')
        and (o.conversation_id = c.id or (cu.id is not null and o.customer_id = cu.id))),
    (select l.status from leads l
      where cu.id is not null and l.business_id = p_business and l.customer_id = cu.id
      order by (l.status in ('new', 'contacted')) desc, l.updated_at desc
      limit 1),
    cu.id is not null and cu.archived_at is null
  from conversations c
  left join customers cu on cu.id = c.customer_id and cu.business_id = p_business
  left join conversation_profiles p
    on p.business_id = p_business and p.channel = c.channel
   and p.participant_id = case c.channel when 'whatsapp' then c.whatsapp_participant_id else c.instagram_participant_id end
  left join lateral (
    select m.created_at as at from messages m
    where m.conversation_id = c.id and m.business_id = p_business
      and m.direction = 'inbound' and m.source = 'customer'
    order by m.created_at desc limit 1
  ) inbound on true
  left join lateral (
    select m.created_at as at from messages m
    where m.conversation_id = c.id and m.business_id = p_business
      and m.direction = 'outbound' and m.source in ('agent', 'staff')
      and (m.delivery_status is null or m.delivery_status in ('sent', 'delivered', 'read', 'uncertain'))
    order by m.created_at desc limit 1
  ) reply on true
  where c.business_id = p_business and c.id = any(p_conversations)
$$;

revoke all on function public.inbox_row_signals(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.inbox_row_signals(uuid, uuid[]) to service_role;
