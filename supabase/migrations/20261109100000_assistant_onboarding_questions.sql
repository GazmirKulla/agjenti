-- Onboarding questions are asked inside the assistant conversation. A question
-- is an assistant message of kind 'onboarding' whose structured choices live in
-- meta; it never triggers a push notification (the trigger ignores this kind).
alter table public.assistant_messages
  add column if not exists meta jsonb check (meta is null or octet_length(meta::text) <= 8192);

do $$ declare c record; begin
  for c in select conname from pg_constraint
    where conrelid = 'public.assistant_messages'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%interrupted%' and pg_get_constraintdef(oid) not like '%role%'
  loop
    execute format('alter table public.assistant_messages drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.assistant_messages add constraint assistant_messages_kind_check
  check (kind in ('user','assistant','backend_outcome','interrupted','onboarding'));
alter table public.assistant_messages add constraint assistant_messages_meta_kind_check
  check (meta is null or kind = 'onboarding');

create or replace function public.write_assistant_conversation(
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
   insert into assistant_messages(conversation_id,seq,request_id,role,kind,content,outcome,meta)
     values(p_id,c.message_seq+1,p_request,'assistant',
       case when p_operation='fail' then 'interrupted' when p_payload ? 'outcome' then 'backend_outcome'
         when p_payload ? 'question' then 'onboarding' else 'assistant' end,
       p_payload->>'content',p_payload->'outcome',
       case when p_operation='finish' and not p_payload ? 'outcome' then p_payload->'question' end);
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
 elsif p_operation='ask' then
   -- An onboarding question the assistant asks on its own, without a user turn.
   if c.pending_request is not null and c.pending_since>now()-interval '2 minutes' then raise exception 'migo_busy'; end if;
   if c.revision is distinct from p_revision then raise exception 'migo_revision_conflict'; end if;
   if jsonb_typeof(p_payload->'question') is distinct from 'object' or coalesce(p_payload->>'content','')='' then raise exception 'migo_invalid'; end if;
   insert into assistant_messages(conversation_id,seq,request_id,role,kind,content,meta)
     values(p_id,c.message_seq+1,gen_random_uuid(),'assistant','onboarding',p_payload->>'content',p_payload->'question');
   update assistant_conversations set message_seq=c.message_seq+1,revision=revision+1,pending_request=null,pending_since=null,
     title=case when c.message_seq=0 then coalesce(nullif(left(btrim(p_payload->>'title'),80),''),title) else title end,
     updated_at=clock_timestamp() where id=p_id returning * into c;
 else raise exception 'migo_invalid';
 end if;
 return to_jsonb(c);
end $$;

revoke all on function public.write_assistant_conversation(uuid,uuid,uuid,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.write_assistant_conversation(uuid,uuid,uuid,text,integer,uuid,jsonb) to service_role;
