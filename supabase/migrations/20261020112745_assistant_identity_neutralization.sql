begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Forward-only rename: the same rows, OIDs, FK targets, grants and RLS.
-- Deploy this before the app switches to assistant_*; keep legacy entry points
-- for old servers and rollback. There is only one storage/writer implementation.
do $$ begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'assistant_identity_requires_security_invoker_views';
  end if;
  -- Refuse to replace an independently changed writer without review.
  -- This is the exact body installed by 20261020104503_migo_private_conversations.
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure(
      'public.write_migo_conversation(uuid,uuid,uuid,text,integer,uuid,jsonb)'))
      is distinct from '4dd52580b0c4617e61aa19b00f3445cd' then
    raise exception 'assistant_identity_writer_review_required';
  end if;
end $$;

lock table public.migo_conversations,public.migo_messages,public.migo_plan_snapshots in access exclusive mode;
alter table public.migo_conversations rename to assistant_conversations;
alter table public.migo_messages rename to assistant_messages;
alter table public.migo_plan_snapshots rename to assistant_plan_snapshots;
alter index public.migo_recent rename to assistant_recent;
alter policy migo_owner_read on public.assistant_conversations rename to assistant_owner_read;
alter policy migo_message_read on public.assistant_messages rename to assistant_message_read;
alter policy migo_plan_read on public.assistant_plan_snapshots rename to assistant_plan_read;

-- Constraint/index names change only; definitions and dependency OIDs stay intact.
do $$ declare c record; begin
  for c in select conrelid::regclass as relation,conname from pg_constraint
    where conrelid in ('public.assistant_conversations'::regclass,
      'public.assistant_messages'::regclass,'public.assistant_plan_snapshots'::regclass)
      and left(conname,5)='migo_'
  loop
    execute format('alter table %s rename constraint %I to %I',
      c.relation,c.conname,'assistant_'||substr(c.conname,6));
  end loop;
end $$;

-- Legacy reads obey the CALLER's grants and the unchanged base-table RLS.
create view public.migo_conversations with(security_invoker=true) as select * from public.assistant_conversations;
create view public.migo_messages with(security_invoker=true) as select * from public.assistant_messages;
create view public.migo_plan_snapshots with(security_invoker=true) as select * from public.assistant_plan_snapshots;
revoke all on public.migo_conversations,public.migo_messages,public.migo_plan_snapshots from public,anon,authenticated,service_role;
grant select on public.migo_conversations,public.migo_messages,public.migo_plan_snapshots to authenticated,service_role;
grant insert,update,delete on public.migo_conversations to service_role;
grant insert,delete on public.migo_messages,public.migo_plan_snapshots to service_role;

-- The existing writer, with relation names changed only. Legacy migo_* error
-- codes remain stable so old and new servers classify failures identically.
create function public.write_assistant_conversation(
 p_business uuid,p_user uuid,p_id uuid,p_operation text,p_revision integer default null,
 p_request uuid default null,p_payload jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare c assistant_conversations; prior assistant_messages; plan assistant_plan_snapshots;
begin
 if not(exists(select 1 from business_users where business_id=p_business and user_id=p_user)
   or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'migo_forbidden'; end if;
 if p_operation='create' then
   insert into assistant_conversations(id,business_id,owner_user_id) values(p_id,p_business,p_user)
    on conflict(id) do nothing;
 end if;
 select * into c from assistant_conversations where id=p_id and business_id=p_business and owner_user_id=p_user for update;
 if not found or c.deleted_at is not null or c.retention_expires_at<=now() then raise exception 'migo_not_found'; end if;
 if p_operation='create' then return to_jsonb(c); end if;
 if p_operation='begin' then
   if p_request is null or coalesce(p_payload->>'fingerprint','') !~ '^[a-f0-9]{64}$' then raise exception 'migo_invalid'; end if;
   select * into prior from assistant_messages where conversation_id=p_id and request_id=p_request and role='user';
   if found then
     if prior.fingerprint is distinct from p_payload->>'fingerprint' then raise exception 'migo_request_conflict'; end if;
     return jsonb_build_object('duplicate',true,'conversation',to_jsonb(c));
   end if;
   if c.revision is distinct from p_revision then raise exception 'migo_revision_conflict'; end if;
   if c.pending_request is not null and c.pending_since>now()-interval '2 minutes' then raise exception 'migo_busy'; end if;
   if c.pending_request is not null then
     insert into assistant_messages(conversation_id,seq,request_id,role,kind,content)
       values(p_id,c.message_seq+1,c.pending_request,'assistant','interrupted','Kërkesa e mëparshme u ndërpre. Rezultati nuk është i konfirmuar.');
     c.message_seq:=c.message_seq+1;
   end if;
   insert into assistant_messages(conversation_id,seq,request_id,role,kind,content,context,fingerprint)
     values(p_id,c.message_seq+1,p_request,'user','user',p_payload->>'content',coalesce(p_payload->'context','{}'),p_payload->>'fingerprint');
   update assistant_conversations set message_seq=c.message_seq+1,revision=revision+1,pending_request=p_request,pending_since=now(),
     title=case when c.message_seq=0 then coalesce(nullif(left(btrim(p_payload->>'content'),80),''),'Bisedë me materiale') else title end,
     updated_at=clock_timestamp() where id=p_id returning * into c;
 elsif p_operation in ('finish','fail') then
   if p_request is null or c.pending_request is distinct from p_request then raise exception 'migo_request_conflict'; end if;
   insert into assistant_messages(conversation_id,seq,request_id,role,kind,content,outcome)
     values(p_id,c.message_seq+1,p_request,'assistant',
       case when p_operation='fail' then 'interrupted' when p_payload ? 'outcome' then 'backend_outcome' else 'assistant' end,
       p_payload->>'content',p_payload->'outcome');
   if p_operation='finish' and p_payload ? 'snapshot' then
     insert into assistant_plan_snapshots(conversation_id,revision,request_id,snapshot,preferences)
       values(p_id,c.plan_revision+1,p_request,p_payload->'snapshot',coalesce(p_payload->'preferences','{}'));
     c.plan_revision:=c.plan_revision+1;
   end if;
   update assistant_conversations set message_seq=c.message_seq+1,plan_revision=c.plan_revision,revision=revision+1,
     pending_request=null,pending_since=null,updated_at=clock_timestamp() where id=p_id returning * into c;
 elsif p_operation in ('preferences','close_plan') then
   -- An expired turn is fenced only by an explicit new begin, not by a
   -- preference change that a late AI completion could otherwise overwrite.
   if c.pending_request is not null then raise exception 'migo_busy'; end if;
   if c.plan_revision is distinct from p_revision then raise exception 'migo_revision_conflict'; end if;
   select * into plan from assistant_plan_snapshots where conversation_id=p_id and revision=c.plan_revision;
   if not found then raise exception 'migo_not_found'; end if;
   insert into assistant_plan_snapshots(conversation_id,revision,request_id,snapshot,preferences)
    values(p_id,c.plan_revision+1,plan.request_id,
      case when p_operation='close_plan' then '{"version":1,"request":"","message":"Plani u mbyll pa ekzekutim."}'::jsonb else plan.snapshot end,
      case when p_operation='close_plan' then '{}'::jsonb else p_payload end);
   if p_operation='close_plan' then
     insert into assistant_messages(conversation_id,seq,request_id,role,kind,content)
       values(p_id,c.message_seq+1,gen_random_uuid(),'user','user','Mbylla propozimin pa ekzekutim.');
     c.message_seq:=c.message_seq+1;
   end if;
   update assistant_conversations set message_seq=c.message_seq,plan_revision=plan_revision+1,revision=revision+1,updated_at=clock_timestamp()
    where id=p_id returning * into c;
 elsif p_operation in ('rename','delete') then
   if c.revision is distinct from p_revision then raise exception 'migo_revision_conflict'; end if;
   if p_operation='rename' then
     update assistant_conversations set title=btrim(p_payload->>'title'),revision=revision+1,updated_at=clock_timestamp()
      where id=p_id returning * into c;
   else
     -- Remove private contents immediately; keep only a tombstone to fence stale tabs.
     delete from assistant_messages where conversation_id=p_id;
     delete from assistant_plan_snapshots where conversation_id=p_id;
     update assistant_conversations set title='Deleted',deleted_at=now(),pending_request=null,pending_since=null,revision=revision+1,
       updated_at=clock_timestamp() where id=p_id returning * into c;
   end if;
 else raise exception 'migo_invalid';
 end if;
 return to_jsonb(c);
end $$;

revoke all on function public.write_assistant_conversation(uuid,uuid,uuid,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.write_assistant_conversation(uuid,uuid,uuid,text,integer,uuid,jsonb) to service_role;

-- Compatibility wrapper, not a second writer. Invoker + identical service-only ACL.
create or replace function public.write_migo_conversation(
 p_business uuid,p_user uuid,p_id uuid,p_operation text,p_revision integer default null,
 p_request uuid default null,p_payload jsonb default '{}'
) returns jsonb language sql security invoker set search_path=public as $$
 select public.write_assistant_conversation(p_business,p_user,p_id,p_operation,p_revision,p_request,p_payload);
$$;
revoke all on function public.write_migo_conversation(uuid,uuid,uuid,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.write_migo_conversation(uuid,uuid,uuid,text,integer,uuid,jsonb) to service_role;
comment on function public.write_migo_conversation(uuid,uuid,uuid,text,integer,uuid,jsonb)
 is 'Legacy compatibility alias for write_assistant_conversation; retain until all older clients are retired.';
notify pgrst, 'reload schema';
commit;
