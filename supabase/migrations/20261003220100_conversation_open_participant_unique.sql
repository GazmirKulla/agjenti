-- Finish unique open-participant index after deduplicating legacy threads.
-- Safe to run if earlier migration steps already applied.

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

create unique index if not exists idx_conversations_one_open_participant
	on public.conversations (business_id, instagram_participant_id)
	where instagram_participant_id is not null
		and status in ('active', 'paused');
