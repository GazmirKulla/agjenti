-- Bind process delivery receipts to the existing transport transaction.
-- No historical data reset; legacy jobs keep their current behavior.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.workflow_inbound_queue add column process_runtime boolean not null default false;

create function public.mark_process_reply() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.status='prepared' and old.status='processing' and exists (
  select 1 from public.process_event_receipts r where r.job_id=new.id and r.business_id=new.business_id and r.conversation_id=new.conversation_id
 ) then
  new.process_runtime:=true;
 end if;
 return new;
end $$;
create trigger process_reply_marker before update of status on public.workflow_inbound_queue
for each row execute function public.mark_process_reply();

create function public.record_delivered_process_reply() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 -- This executes inside the same transaction as finish_workflow_send (including panel chat).
 -- A failure rolls back the receipt; retry persists it without resending to the provider.
 perform public.record_process_presentation(new.business_id,new.id,new.lease_token);
 return null;
end $$;
create trigger process_reply_delivered after update of status on public.workflow_inbound_queue
for each row when (new.status='sent' and old.status is distinct from 'sent' and new.process_runtime)
execute function public.record_delivered_process_reply();
revoke all on function public.mark_process_reply(),public.record_delivered_process_reply() from public,anon,authenticated;
commit;
