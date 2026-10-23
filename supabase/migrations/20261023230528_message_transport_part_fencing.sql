-- A late ACK is evidence, not permission for another external send.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function public.guard_transport_part_start() returns trigger
language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare job public.workflow_inbound_queue;
begin
 if new.status='sending' then
  select * into job from public.workflow_inbound_queue where id=new.job_id for update;
  if not found or job.status<>'sending' or job.leased_until is null or job.leased_until<=clock_timestamp() then
   raise exception 'lease_lost';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_transport_part_start() from public,anon,authenticated;
grant execute on function public.guard_transport_part_start() to service_role;
create trigger guard_transport_part_start before insert or update on public.message_transport_parts
for each row execute function public.guard_transport_part_start();
commit;
