begin;
create table if not exists public.visual_workflow_events (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 revision integer not null,
 before_data jsonb,
 after_data jsonb not null,
 created_at timestamptz not null default now(),
 unique(business_id,revision)
);
create table if not exists public.assistant_visual_requests (
 id uuid primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 payload jsonb not null,
 result_revision integer not null,
 created_at timestamptz not null default now()
);
alter table public.visual_workflow_events enable row level security;
alter table public.assistant_visual_requests enable row level security;
drop policy if exists visual_history_read on public.visual_workflow_events;
create policy visual_history_read on public.visual_workflow_events for select to authenticated using(is_business_member(business_id) or is_platform_admin());
revoke all on public.visual_workflow_events,public.assistant_visual_requests from public,anon,authenticated,service_role;
grant select on public.visual_workflow_events to authenticated,service_role;

create or replace function public.record_visual_workflow_event() returns trigger
language plpgsql security definer set search_path=public as $$ begin
 insert into visual_workflow_events(business_id,actor_id,revision,before_data,after_data)
 values(new.business_id,new.updated_by,new.revision,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
revoke all on function public.record_visual_workflow_event() from public,anon,authenticated,service_role;
drop trigger if exists visual_workflow_audit on public.visual_workflows;
create trigger visual_workflow_audit after insert or update on public.visual_workflows for each row execute function public.record_visual_workflow_event();

create or replace function public.apply_assistant_visual_workflow(p_business uuid,p_user uuid,p_revision integer,p_graph jsonb,p_operation text,p_request uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare previous assistant_visual_requests; payload jsonb; result integer;
begin
 perform 1 from businesses where id=p_business for update;
 if not found or not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 if p_request is null then raise exception 'invalid_request'; end if;
 payload:=jsonb_build_object('revision',p_revision,'graph',p_graph,'operation',p_operation);
 select * into previous from assistant_visual_requests where id=p_request;
 if found then
  if previous.business_id is distinct from p_business or previous.actor_id is distinct from p_user or previous.payload is distinct from payload then raise exception 'invalid_replay'; end if;
  return previous.result_revision;
 end if;
 result:=save_visual_workflow(p_business,p_user,p_revision,p_graph,p_operation);
 insert into assistant_visual_requests(id,business_id,actor_id,payload,result_revision) values(p_request,p_business,p_user,payload,result);
 return result;
end $$;
revoke all on function public.apply_assistant_visual_workflow(uuid,uuid,integer,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.apply_assistant_visual_workflow(uuid,uuid,integer,jsonb,text,uuid) to service_role;
commit;
