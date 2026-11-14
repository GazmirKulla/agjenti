-- Training from conversations, phase 2: what the analysis proposes. Each
-- suggestion names where it belongs (style, an example reply, knowledge, a
-- product, a service, the business profile, a workflow, or a question nobody
-- answered), whether it is new or changes an existing record, the
-- conversations it comes from, and whether the owner must confirm it.
-- Nothing is applied here: the owner reviews every suggestion first.
begin;

-- The analysis keeps its candidates between steps.
alter table public.conversation_training_sessions drop constraint if exists conversation_training_sessions_checkpoint_check;
alter table public.conversation_training_sessions add constraint conversation_training_sessions_checkpoint_check
 check (jsonb_typeof(checkpoint)='object' and octet_length(checkpoint::text) <= 1048576);

create table public.conversation_training_suggestions (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 session_id uuid not null references public.conversation_training_sessions(id) on delete cascade,
 destination text not null check (destination in ('style','example','knowledge','product','service','profile','workflow','gap')),
 operation text not null check (operation in ('create','update','duplicate','conflict')),
 -- The existing record it updates or resembles (product, service, knowledge entry).
 target_table text check (target_table is null or target_table in ('products','booking_services','knowledge_entries','ai_agents','business_calendar_settings')),
 target_id uuid,
 title text not null check (length(btrim(title)) between 1 and 300),
 current_value jsonb check (current_value is null or octet_length(current_value::text) <= 16384),
 proposed jsonb not null check (jsonb_typeof(proposed)='object' and octet_length(proposed::text) <= 16384),
 -- Quotes with the conversation (one-way key) and date they come from.
 evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence)='array' and octet_length(evidence::text) <= 16384),
 confidence text not null check (confidence in ('high','medium','low')),
 explicit boolean not null default true,
 requires_confirmation boolean not null default false,
 risk text not null check (risk in ('safe','important')),
 status text not null default 'pending' check (status in ('pending','approved','rejected','applied','failed','superseded')),
 edited jsonb check (edited is null or (jsonb_typeof(edited)='object' and octet_length(edited::text) <= 16384)),
 applied_ref jsonb,
 -- The same proposal from any session has the same content key (a rejected one is not
 -- proposed again); the idempotency key adds the session, so a retried step never stores it twice.
 content_key text not null check (content_key ~ '^[0-9a-f]{64}$'),
 idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
 schema_version integer not null default 1,
 decided_by uuid references auth.users(id) on delete set null,
 decided_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (business_id, idempotency_key)
);
create index conversation_training_suggestions_session on public.conversation_training_suggestions(session_id, destination);
create index conversation_training_suggestions_content on public.conversation_training_suggestions(business_id, content_key);
create index conversation_training_suggestions_pending on public.conversation_training_suggestions(business_id) where status='pending';
alter table public.conversation_training_suggestions enable row level security;
revoke all on public.conversation_training_suggestions from anon, authenticated;

commit;
