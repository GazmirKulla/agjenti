-- Training the agent from the business's own conversations (phase 1: import).
-- A session reads one source (the Inbox stored in Agjenti, or an Instagram
-- data export the owner uploads) in short leased steps, and keeps each message
-- once per business, without names, so later imports never count it twice.
-- Nothing here messages a customer or changes the business configuration.
begin;

create table public.conversation_training_sessions (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete set null,
 source text not null check (source in ('inbox','instagram_export')),
 status text not null default 'queued' check (status in ('uploading','queued','running','ready','failed','cancelled')),
 stage text not null default 'ingest' check (stage ~ '^[a-z_]{2,40}$'),
 -- Uploaded files (storage paths under the business's folder, names, sizes).
 input jsonb not null default '{}'::jsonb check (jsonb_typeof(input)='object' and octet_length(input::text) <= 16384),
 checkpoint jsonb not null default '{}'::jsonb check (jsonb_typeof(checkpoint)='object' and octet_length(checkpoint::text) <= 262144),
 progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress)='object' and octet_length(progress::text) <= 4096),
 stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats)='object' and octet_length(stats::text) <= 16384),
 schema_version integer not null default 1,
 attempts integer not null default 0,
 lease_token uuid,
 leased_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 error text check (error is null or length(error) <= 500),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 finished_at timestamptz,
 -- Imported conversations are private: they are deleted after this date.
 expires_at timestamptz not null default now() + interval '30 days'
);
create index conversation_training_sessions_business on public.conversation_training_sessions(business_id, created_at desc);
create index conversation_training_sessions_due on public.conversation_training_sessions(next_attempt_at) where status in ('queued','running');
-- One import at a time per business.
create unique index conversation_training_sessions_one_active on public.conversation_training_sessions(business_id) where status in ('uploading','queued','running');
alter table public.conversation_training_sessions enable row level security;

create table public.conversation_training_messages (
 id bigint generated always as identity primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 -- The session that first brought this message; deleting it deletes the message.
 session_id uuid not null references public.conversation_training_sessions(id) on delete cascade,
 source text not null check (source in ('inbox','instagram_export')),
 -- A one-way hash of the conversation's participant: never a name or an id.
 thread_key text not null check (thread_key ~ '^[0-9a-f]{32}$'),
 speaker text not null check (speaker in ('customer','owner','agent')),
 body text not null check (length(body) between 1 and 2000),
 sent_at timestamptz not null,
 content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
 analyzed_at timestamptz,
 created_at timestamptz not null default now(),
 unique (business_id, content_hash)
);
create index conversation_training_messages_thread on public.conversation_training_messages(business_id, thread_key, sent_at);
create index conversation_training_messages_session on public.conversation_training_messages(session_id);
alter table public.conversation_training_messages enable row level security;

-- Private uploads, read only by the server; each business writes under its own folder
-- through a signed upload URL the server issues.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('conversation-training','conversation-training',false,104857600,
 array['application/zip','application/x-zip-compressed','application/json','text/html','application/octet-stream'])
on conflict (id) do nothing;

create function public.start_conversation_training(p_business uuid, p_user uuid, p_source text, p_input jsonb, p_status text default 'queued')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 perform 1 from businesses where id=p_business for update;
 if not found or not (exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 if p_source not in ('inbox','instagram_export') or p_status not in ('uploading','queued') then raise exception 'invalid_source'; end if;
 -- An upload that was never finished does not block a new one.
 update conversation_training_sessions set status='cancelled',error='Ngarkimi nuk përfundoi.',updated_at=now(),finished_at=now()
  where business_id=p_business and status='uploading' and created_at < now() - interval '2 hours';
 if exists(select 1 from conversation_training_sessions where business_id=p_business and status in ('uploading','queued','running')) then raise exception 'session_active'; end if;
 if (select count(*) from conversation_training_sessions where business_id=p_business and created_at > now() - interval '1 day') >= 10 then raise exception 'daily_limit'; end if;
 insert into conversation_training_sessions(business_id,user_id,source,input,status) values (p_business,p_user,p_source,coalesce(p_input,'{}'::jsonb),p_status) returning id into v_id;
 return v_id;
end $$;

create function public.claim_conversation_training(p_business uuid default null)
returns setof public.conversation_training_sessions language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 update conversation_training_sessions set status='failed',error='Importi u ndërpre pas tri provash. Provo përsëri.',lease_token=null,leased_until=null,updated_at=now(),finished_at=now()
  where (p_business is null or business_id=p_business) and status='running' and leased_until<now() and attempts>=3;
 select id into v_id from conversation_training_sessions
  where (p_business is null or business_id=p_business) and next_attempt_at<=now()
  and (status='queued' or (status='running' and leased_until<now()))
  order by next_attempt_at,id for update skip locked limit 1;
 if v_id is null then return; end if;
 return query update conversation_training_sessions set status='running',lease_token=gen_random_uuid(),leased_until=now()+interval '3 minutes',attempts=attempts+1,updated_at=now()
  where id=v_id returning *;
end $$;

-- Saves a step. p_done finishes the session; an error retries it (up to three attempts).
create function public.checkpoint_conversation_training(p_session uuid, p_lease uuid, p_checkpoint jsonb, p_stage text, p_progress jsonb, p_stats jsonb, p_done boolean default false, p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update conversation_training_sessions set checkpoint=p_checkpoint, stage=p_stage, progress=coalesce(p_progress,progress), stats=coalesce(p_stats,stats),
  status=case when p_done then 'ready' when p_error is not null and attempts>=3 then 'failed' else 'queued' end,
  error=p_error, attempts=case when p_error is null then 0 else attempts end,
  next_attempt_at=now()+case when p_error is null then interval '0 seconds' else interval '30 seconds' end,
  finished_at=case when p_done or (p_error is not null and attempts>=3) then now() else null end,
  lease_token=null, leased_until=null, updated_at=now()
 where id=p_session and status='running' and lease_token=p_lease and leased_until>now();
 return found;
end $$;

-- Adds a batch of messages to the session that holds the lease. A message already
-- kept for the business (same hash, or the same message one minute away) is skipped.
create function public.ingest_conversation_training_messages(p_session uuid, p_lease uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare v_session conversation_training_sessions; v_count integer;
begin
 select * into v_session from conversation_training_sessions where id=p_session and status='running' and lease_token=p_lease and leased_until>now();
 if not found then raise exception 'lease_expired'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 then raise exception 'invalid_rows'; end if;
 insert into conversation_training_messages(business_id,session_id,source,thread_key,speaker,body,sent_at,content_hash)
 select v_session.business_id, v_session.id, v_session.source, r.thread_key, r.speaker, r.body, r.sent_at, r.content_hash
 from jsonb_to_recordset(p_rows) as r(thread_key text, speaker text, body text, sent_at timestamptz, content_hash text, nearby_hashes text[])
 where not exists (select 1 from conversation_training_messages m where m.business_id=v_session.business_id
   and m.content_hash = any(coalesce(r.nearby_hashes,'{}'::text[]) || r.content_hash))
 on conflict (business_id, content_hash) do nothing;
 get diagnostics v_count = row_count;
 return v_count;
end $$;

revoke all on function public.start_conversation_training(uuid,uuid,text,jsonb,text), public.claim_conversation_training(uuid),
 public.checkpoint_conversation_training(uuid,uuid,jsonb,text,jsonb,jsonb,boolean,text),
 public.ingest_conversation_training_messages(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.start_conversation_training(uuid,uuid,text,jsonb,text), public.claim_conversation_training(uuid),
 public.checkpoint_conversation_training(uuid,uuid,jsonb,text,jsonb,jsonb,boolean,text),
 public.ingest_conversation_training_messages(uuid,uuid,jsonb) to service_role;
revoke all on public.conversation_training_sessions, public.conversation_training_messages from anon, authenticated;

commit;
