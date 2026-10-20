begin;

-- Owner-facing history, deliberately separate from customer conversations.
create table public.migo_conversations (
 id uuid primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 owner_user_id uuid not null references auth.users(id) on delete cascade,
 title text not null default 'Bisedë e re' check (char_length(title) between 1 and 100),
 revision integer not null default 0,
 message_seq bigint not null default 0,
 plan_revision integer not null default 0,
 pending_request uuid,
 pending_since timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 archived_at timestamptz,
 retention_expires_at timestamptz,
 deleted_at timestamptz
);
create index migo_recent on public.migo_conversations(owner_user_id,business_id,updated_at desc,id desc)
 where deleted_at is null;
create table public.migo_messages (
 conversation_id uuid not null references public.migo_conversations(id) on delete cascade,
 seq bigint not null,
 request_id uuid not null,
 role text not null check(role in ('user','assistant')),
 kind text not null check(kind in ('user','assistant','backend_outcome','interrupted')),
 content text not null check(char_length(content)<=12000),
 context jsonb not null default '{}' check(octet_length(context::text)<=16384),
 fingerprint text,
 outcome jsonb check(outcome is null or octet_length(outcome::text)<=16384),
 created_at timestamptz not null default now(),
 primary key(conversation_id,seq),
 unique(conversation_id,request_id,role),
 check((role='user' and kind='user' and outcome is null) or
       (role='assistant' and kind<>'user' and (outcome is null or kind='backend_outcome')))
);
create table public.migo_plan_snapshots (
 conversation_id uuid not null references public.migo_conversations(id) on delete cascade,
 revision integer not null,
 request_id uuid not null,
 schema_version integer not null default 1 check(schema_version=1),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=524288),
 preferences jsonb not null default '{}' check(jsonb_typeof(preferences)='object' and octet_length(preferences::text)<=16384),
 created_at timestamptz not null default now(),
 primary key(conversation_id,revision),
 check(snapshot::text !~* '"(token|pendingToken|publicationApproval|authorization|password|api_key|secret|credentials)"[[:space:]]*:'),
 check(preferences::text !~* '"(token|authorization|password|secret)"[[:space:]]*:')
);

alter table public.migo_conversations enable row level security;
alter table public.migo_messages enable row level security;
alter table public.migo_plan_snapshots enable row level security;
create policy migo_owner_read on public.migo_conversations for select to authenticated
 using(owner_user_id=(select auth.uid()) and is_business_member(business_id)
   and deleted_at is null and (retention_expires_at is null or retention_expires_at>now()));
create policy migo_message_read on public.migo_messages for select to authenticated
 using(exists(select 1 from public.migo_conversations c where c.id=conversation_id));
create policy migo_plan_read on public.migo_plan_snapshots for select to authenticated
 using(exists(select 1 from public.migo_conversations c where c.id=conversation_id));
revoke all on public.migo_conversations,public.migo_messages,public.migo_plan_snapshots from public,anon,authenticated,service_role;
grant select on public.migo_conversations,public.migo_messages,public.migo_plan_snapshots to authenticated,service_role;
grant insert,update,delete on public.migo_conversations to service_role;
-- Messages and snapshots cannot be updated, including by the application service.
grant insert,delete on public.migo_messages,public.migo_plan_snapshots to service_role;

-- Short persistence transactions only. Never holds a lock during an AI/provider call.
-- Invoker privileges; this API is callable only by the authenticated server service.
create function public.write_migo_conversation(
 p_business uuid,p_user uuid,p_id uuid,p_operation text,p_revision integer default null,
 p_request uuid default null,p_payload jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare c migo_conversations; prior migo_messages; plan migo_plan_snapshots;
begin
 if not(exists(select 1 from business_users where business_id=p_business and user_id=p_user)
   or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'migo_forbidden'; end if;
 if p_operation='create' then
   insert into migo_conversations(id,business_id,owner_user_id) values(p_id,p_business,p_user)
    on conflict(id) do nothing;
 end if;
 select * into c from migo_conversations where id=p_id and business_id=p_business and owner_user_id=p_user for update;
 if not found or c.deleted_at is not null or c.retention_expires_at<=now() then raise exception 'migo_not_found'; end if;
 if p_operation='create' then return to_jsonb(c); end if;
 if p_operation='begin' then
   if p_request is null or coalesce(p_payload->>'fingerprint','') !~ '^[a-f0-9]{64}$' then raise exception 'migo_invalid'; end if;
   select * into prior from migo_messages where conversation_id=p_id and request_id=p_request and role='user';
   if found then
     if prior.fingerprint is distinct from p_payload->>'fingerprint' then raise exception 'migo_request_conflict'; end if;
     return jsonb_build_object('duplicate',true,'conversation',to_jsonb(c));
   end if;
   if c.revision is distinct from p_revision then raise exception 'migo_revision_conflict'; end if;
   if c.pending_request is not null and c.pending_since>now()-interval '2 minutes' then raise exception 'migo_busy'; end if;
   if c.pending_request is not null then
     insert into migo_messages(conversation_id,seq,request_id,role,kind,content)
       values(p_id,c.message_seq+1,c.pending_request,'assistant','interrupted','Kërkesa e mëparshme u ndërpre. Rezultati nuk është i konfirmuar.');
     c.message_seq:=c.message_seq+1;
   end if;
   insert into migo_messages(conversation_id,seq,request_id,role,kind,content,context,fingerprint)
     values(p_id,c.message_seq+1,p_request,'user','user',p_payload->>'content',coalesce(p_payload->'context','{}'),p_payload->>'fingerprint');
   update migo_conversations set message_seq=c.message_seq+1,revision=revision+1,pending_request=p_request,pending_since=now(),
     title=case when c.message_seq=0 then coalesce(nullif(left(btrim(p_payload->>'content'),80),''),'Bisedë me materiale') else title end,
     updated_at=clock_timestamp() where id=p_id returning * into c;
 elsif p_operation in ('finish','fail') then
   if p_request is null or c.pending_request is distinct from p_request then raise exception 'migo_request_conflict'; end if;
   insert into migo_messages(conversation_id,seq,request_id,role,kind,content,outcome)
     values(p_id,c.message_seq+1,p_request,'assistant',
       case when p_operation='fail' then 'interrupted' when p_payload ? 'outcome' then 'backend_outcome' else 'assistant' end,
       p_payload->>'content',p_payload->'outcome');
   if p_operation='finish' and p_payload ? 'snapshot' then
     insert into migo_plan_snapshots(conversation_id,revision,request_id,snapshot,preferences)
       values(p_id,c.plan_revision+1,p_request,p_payload->'snapshot',coalesce(p_payload->'preferences','{}'));
     c.plan_revision:=c.plan_revision+1;
   end if;
   update migo_conversations set message_seq=c.message_seq+1,plan_revision=c.plan_revision,revision=revision+1,
     pending_request=null,pending_since=null,updated_at=clock_timestamp() where id=p_id returning * into c;
 elsif p_operation in ('preferences','close_plan') then
   -- An expired turn is fenced only by an explicit new begin, not by a
   -- preference change that a late AI completion could otherwise overwrite.
   if c.pending_request is not null then raise exception 'migo_busy'; end if;
   if c.plan_revision is distinct from p_revision then raise exception 'migo_revision_conflict'; end if;
   select * into plan from migo_plan_snapshots where conversation_id=p_id and revision=c.plan_revision;
   if not found then raise exception 'migo_not_found'; end if;
   insert into migo_plan_snapshots(conversation_id,revision,request_id,snapshot,preferences)
    values(p_id,c.plan_revision+1,plan.request_id,
      case when p_operation='close_plan' then '{"version":1,"request":"","message":"Plani u mbyll pa ekzekutim."}'::jsonb else plan.snapshot end,
      case when p_operation='close_plan' then '{}'::jsonb else p_payload end);
   if p_operation='close_plan' then
     insert into migo_messages(conversation_id,seq,request_id,role,kind,content)
       values(p_id,c.message_seq+1,gen_random_uuid(),'user','user','Mbylla propozimin pa ekzekutim.');
     c.message_seq:=c.message_seq+1;
   end if;
   update migo_conversations set message_seq=c.message_seq,plan_revision=plan_revision+1,revision=revision+1,updated_at=clock_timestamp()
    where id=p_id returning * into c;
 elsif p_operation in ('rename','delete') then
   if c.revision is distinct from p_revision then raise exception 'migo_revision_conflict'; end if;
   if p_operation='rename' then
     update migo_conversations set title=btrim(p_payload->>'title'),revision=revision+1,updated_at=clock_timestamp()
      where id=p_id returning * into c;
   else
     -- Remove private contents immediately; keep only a tombstone to fence stale tabs.
     delete from migo_messages where conversation_id=p_id;
     delete from migo_plan_snapshots where conversation_id=p_id;
     update migo_conversations set title='Deleted',deleted_at=now(),pending_request=null,pending_since=null,revision=revision+1,
       updated_at=clock_timestamp() where id=p_id returning * into c;
   end if;
 else raise exception 'migo_invalid';
 end if;
 return to_jsonb(c);
end $$;
revoke all on function public.write_migo_conversation(uuid,uuid,uuid,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.write_migo_conversation(uuid,uuid,uuid,text,integer,uuid,jsonb) to service_role;
commit;
