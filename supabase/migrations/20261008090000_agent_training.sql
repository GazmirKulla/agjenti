-- Explicit business training, separate from customer transcripts and factual knowledge.
create table public.agent_training_memories (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 kind text not null check (kind in ('style','example','workflow')),
 instruction text not null check (length(btrim(instruction)) between 1 and 1500),
 customer_message text not null default '' check (length(customer_message)<=2000),
 desired_response text not null default '' check (length(desired_response)<=3000),
 workflow_id uuid references public.workflows(id) on delete cascade,
 step_key text check (length(btrim(step_key)) between 1 and 100),
 source text not null default 'manual' check (source in ('manual','test_feedback')),
 is_active boolean not null default true, revision integer not null default 1,
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (step_key is null or workflow_id is not null),
 check (kind<>'style' or (workflow_id is null and step_key is null)),
 check (kind<>'workflow' or workflow_id is not null),
 check (kind<>'example' or (length(btrim(customer_message))>0 and length(btrim(desired_response))>0)),
 foreign key (workflow_id,step_key) references public.workflow_steps(workflow_id,key) on delete cascade on update cascade
);
create index on public.agent_training_memories(business_id,is_active,updated_at desc);
create table public.agent_training_events (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 memory_id uuid not null, operation text not null, before_value jsonb, after_value jsonb,
 created_at timestamptz not null default now()
);
create index on public.agent_training_events(business_id,memory_id,created_at desc);
alter table public.agent_training_memories enable row level security;
alter table public.agent_training_events enable row level security;
create policy training_read on public.agent_training_memories for select to authenticated using (is_business_member(business_id) or is_platform_admin());
create policy training_events_read on public.agent_training_events for select to authenticated using (is_business_member(business_id) or is_platform_admin());
revoke all on public.agent_training_memories,public.agent_training_events from public,anon,authenticated;
grant select on public.agent_training_memories,public.agent_training_events to authenticated;
grant all on public.agent_training_memories,public.agent_training_events to service_role;

create function public.validate_agent_training() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then
  perform 1 from businesses where id=new.business_id for update;
  if (select count(*) from agent_training_memories where business_id=new.business_id)>=200 then raise exception 'training_memory_limit'; end if;
  new.revision:=1;
 else
  if new.business_id<>old.business_id or new.id<>old.id then raise exception 'training_tenant_immutable'; end if;
  new.revision:=old.revision+1;
  new.created_at:=old.created_at; new.created_by:=old.created_by;
 end if;
 if new.workflow_id is not null and not exists(select 1 from workflows where id=new.workflow_id and business_id=new.business_id) then raise exception 'training_workflow_tenant'; end if;
 if new.step_key is not null and not exists(select 1 from workflow_steps where workflow_id=new.workflow_id and key=new.step_key) then raise exception 'training_step_missing'; end if;
 new.updated_at:=clock_timestamp();
 return new;
end $$;
create trigger validate_agent_training before insert or update on public.agent_training_memories for each row execute function public.validate_agent_training();
create function public.audit_agent_training() returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- Parent tenant deletion also cascades history; do not recreate a deleted parent.
 if tg_op='DELETE' then
  if exists(select 1 from businesses where id=old.business_id) then
   insert into agent_training_events(business_id,memory_id,operation,before_value) values(old.business_id,old.id,tg_op,to_jsonb(old));
  end if;
  return old;
 end if;
 insert into agent_training_events(business_id,memory_id,operation,before_value,after_value)
 values(new.business_id,new.id,tg_op,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
create trigger audit_agent_training after insert or update or delete on public.agent_training_memories for each row execute function public.audit_agent_training();
revoke all on function public.validate_agent_training(),public.audit_agent_training() from public,anon,authenticated;

-- Preserve all existing readiness checks; training edits invalidate the test fingerprint.
alter function public.business_setup_status(uuid) rename to pre_training_business_setup_status;
create function public.business_setup_status(p_business_id uuid) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare base jsonb; memories jsonb; signature text;
begin
 base:=pre_training_business_setup_status(p_business_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision) order by id),'[]'::jsonb) into memories
 from agent_training_memories where business_id=p_business_id and is_active;
 signature:=case when jsonb_array_length(memories)>0 then md5((base->>'signature')||memories::text) else base->>'signature' end;
 return base||jsonb_build_object('signature',signature,'tested',coalesce((select tested_signature=signature from business_setup where business_id=p_business_id),false));
end $$;
revoke all on function public.business_setup_status(uuid),public.pre_training_business_setup_status(uuid) from public,anon,authenticated;
grant execute on function public.business_setup_status(uuid),public.pre_training_business_setup_status(uuid) to service_role;
