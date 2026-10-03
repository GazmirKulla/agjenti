-- Conversations can exist without a CRM customer row.
-- Participant Instagram identity lives on the conversation until a manager
-- confirms an order or manually promotes the thread to a customer.

alter table public.conversations
	alter column customer_id drop not null;

alter table public.conversations
	add column if not exists instagram_participant_id text,
	add column if not exists participant_username text,
	add column if not exists participant_display_name text;

-- Backfill participant fields from the linked customer (legacy auto-created rows).
update public.conversations c
set
	instagram_participant_id = coalesce(c.instagram_participant_id, cust.instagram_user_id),
	participant_username = coalesce(c.participant_username, cust.username),
	participant_display_name = coalesce(c.participant_display_name, cust.display_name)
from public.customers cust
where cust.id = c.customer_id
	and (
		c.instagram_participant_id is null
		or c.participant_username is null
		or c.participant_display_name is null
	);

-- Close duplicate open threads so the unique index can be created.
-- Keep the newest conversation per (business_id, instagram_participant_id).
with ranked as (
	select
		id,
		row_number() over (
			partition by business_id, instagram_participant_id
			order by last_message_at desc nulls last, created_at desc, id desc
		) as rn
	from public.conversations
	where instagram_participant_id is not null
		and status in ('active', 'paused')
)
update public.conversations c
set
	status = 'completed',
	updated_at = now()
from ranked r
where c.id = r.id
	and r.rn > 1;

create index if not exists idx_conversations_participant_lookup
	on public.conversations (business_id, instagram_participant_id, last_message_at desc)
	where instagram_participant_id is not null;

-- At most one open thread per Instagram participant per business.
create unique index if not exists idx_conversations_one_open_participant
	on public.conversations (business_id, instagram_participant_id)
	where instagram_participant_id is not null
		and status in ('active', 'paused');
