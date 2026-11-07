begin;
set local lock_timeout='5s';
-- Pre-production reset authorized by the owner. Stop workers before applying.
-- Lock ordering matches transport: queue -> conversations -> state.
lock table public.workflow_inbound_queue in share row exclusive mode;
lock table public.conversations in share row exclusive mode;
lock table public.conversation_states in share row exclusive mode;
do $$ begin
  if exists(select 1 from public.workflow_inbound_queue where status in ('processing','sending') and leased_until>now()) then
    raise exception 'cutover_worker_active';
  end if;
  if exists(select 1 from public.conversation_states where collected->>'schemaVersion' is not null
    and collected->>'schemaVersion' not in ('1','2','3','4')) then raise exception 'cutover_unknown_state_version'; end if;
end $$;
-- Never alter staff delivery receipts, including uncertain deliveries. Native
-- action receipts and their pending turns are also preserved unchanged.
update public.workflow_inbound_queue q set status='ignored',leased_until=null,
  error='Pre-production process cutover: obsolete queued test or legacy agent output',reply=null
where q.status in ('queued','processing','prepared') and q.operation_kind is distinct from 'staff'
  and (q.operation_kind='test' or exists(select 1 from public.conversation_states s
    where s.conversation_id=q.conversation_id and s.business_id=q.business_id
    and s.collected->>'schemaVersion' is distinct from '4'));
update public.conversation_states s set
  collected=jsonb_build_object('schemaVersion',4,'mode','live','businessId',s.business_id,
    'conversationId',s.conversation_id,'revision',s.revision+1,'instances','{}'::jsonb,'offers','{}'::jsonb,'focusId',null),
  revision=s.revision+1,workflow_id=null,step_key=null,status='in_progress',cart='[]',customer_fields='{}',updated_at=now()
where s.collected->>'schemaVersion' is distinct from '4';

-- New panel rows use the table default {}. This is initialization only: an
-- UPDATE cannot erase a live snapshot by passing an empty object.
create function public.initialize_process_snapshot() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$ begin
  if new.collected='{}'::jsonb then
    new.collected:=jsonb_build_object('schemaVersion',4,'mode','live','businessId',new.business_id,
      'conversationId',new.conversation_id,'revision',new.revision,'instances','{}'::jsonb,'offers','{}'::jsonb,'focusId',null);
  end if;
  return new;
end $$;
create trigger initialize_process_snapshot before insert on public.conversation_states
for each row execute function public.initialize_process_snapshot();
revoke all on function public.initialize_process_snapshot() from public,anon,authenticated,service_role;
-- Old SQL writers cannot reintroduce legacy state after this cutover.
alter table public.conversation_states add constraint conversation_states_native_snapshot check ((
  collected->>'schemaVersion'='4' and collected->>'mode'='live'
  and collected->>'businessId'=business_id::text and collected->>'conversationId'=conversation_id::text
  and jsonb_typeof(collected->'revision')='number' and collected->>'revision'=revision::text
  and jsonb_typeof(collected->'instances')='object' and jsonb_typeof(collected->'offers')='object'
  and collected ? 'focusId') is true);
commit;
