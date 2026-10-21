-- Native devices and durable notification delivery. No client can read push tokens.
create table if not exists public.mobile_devices (
 token text primary key check (length(token) between 20 and 250),
 user_id uuid not null references auth.users(id) on delete cascade,
 platform text not null check (platform in ('ios','android')),
 updated_at timestamptz not null default now()
);
create table if not exists public.mobile_notification_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,
 conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
 message_seq bigint not null,
 kind text not null,
 created_at timestamptz not null default now(),
 unique(conversation_id,message_seq)
);
create table if not exists public.mobile_notification_deliveries (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.mobile_notification_events(id) on delete cascade,
 token text not null references public.mobile_devices(token) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','receipt','sent','failed')),
 attempts integer not null default 0,
 next_attempt timestamptz not null default now(),
 receipt_id text,
 unique(event_id,token)
);
alter table public.mobile_devices enable row level security;
alter table public.mobile_notification_events enable row level security;
alter table public.mobile_notification_deliveries enable row level security;
revoke all on public.mobile_devices, public.mobile_notification_events, public.mobile_notification_deliveries from public,anon,authenticated;
grant all on public.mobile_devices, public.mobile_notification_events, public.mobile_notification_deliveries to service_role;

create or replace function public.queue_mobile_assistant_notification() returns trigger language plpgsql security definer set search_path=public as $$
declare event uuid; owner_id uuid; business uuid;
begin
 if new.role <> 'assistant' or new.kind not in ('assistant','backend_outcome','interrupted') then return new; end if;
 select owner_user_id,business_id into owner_id,business from assistant_conversations where id=new.conversation_id and deleted_at is null;
 if owner_id is null then return new; end if;
 insert into mobile_notification_events(user_id,business_id,conversation_id,message_seq,kind)
 values(owner_id,business,new.conversation_id,new.seq,new.kind)
 on conflict(conversation_id,message_seq) do nothing returning id into event;
 if event is not null then
  insert into mobile_notification_deliveries(event_id,token) select event,token from mobile_devices where user_id=owner_id;
 end if;
 return new;
end $$;
revoke all on function public.queue_mobile_assistant_notification() from public,anon,authenticated;
drop trigger if exists mobile_assistant_notification on public.assistant_messages;
create trigger mobile_assistant_notification after insert on public.assistant_messages for each row execute function public.queue_mobile_assistant_notification();

create or replace function public.claim_mobile_deliveries() returns setof public.mobile_notification_deliveries language sql security definer set search_path=public as $$
 update mobile_notification_deliveries set status='sending', attempts=attempts+1, next_attempt=now()+interval '5 minutes'
 where id in (select id from mobile_notification_deliveries where status in ('pending','sending','receipt') and next_attempt<=now() and attempts<8 order by next_attempt for update skip locked limit 20)
 returning *;
$$;
revoke all on function public.claim_mobile_deliveries() from public,anon,authenticated;
grant execute on function public.claim_mobile_deliveries() to service_role;
create index if not exists mobile_delivery_pending on public.mobile_notification_deliveries(next_attempt) where status in ('pending','sending','receipt');
