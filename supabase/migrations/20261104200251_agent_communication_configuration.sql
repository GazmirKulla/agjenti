begin;
alter table public.ai_agents
 add column communication jsonb not null default '{"version":1,"language":"customer","tone":"warm","length":"concise","questions":"when_needed","emoji":"light"}',
 add column configuration_revision bigint not null default 1,
 add column configuration_draft jsonb;

create function public.valid_agent_communication(p jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(p)='object'
 and p->'version'='1'::jsonb
 and p->>'language' in ('customer','sq','en') and p->>'tone' in ('warm','neutral','formal')
 and p->>'length' in ('concise','balanced') and p->>'questions' in ('when_needed','on_request')
 and p->>'emoji' in ('none','light')
 and (p - array['version','language','tone','length','questions','emoji'])='{}'::jsonb, false)
$$;
alter table public.ai_agents add constraint valid_agent_communication check (public.valid_agent_communication(communication));

create table public.agent_configuration_versions (
 agent_id uuid not null references public.ai_agents(id) on delete cascade,
 revision bigint not null,
 business_id uuid not null references public.businesses(id) on delete cascade,
 instructions text not null,
 communication jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(agent_id,revision)
);
alter table public.agent_configuration_versions enable row level security;
revoke all on public.agent_configuration_versions from public,anon,authenticated;
grant select,insert,delete on public.agent_configuration_versions to service_role;
insert into public.agent_configuration_versions(agent_id,revision,business_id,instructions,communication)
 select id,configuration_revision,business_id,instructions,communication from public.ai_agents;

create function public.guard_agent_configuration() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='INSERT' then new.configuration_revision:=1;
 elsif new.instructions is distinct from old.instructions or new.communication is distinct from old.communication then
  new.configuration_revision:=old.configuration_revision+1;
 else new.configuration_revision:=old.configuration_revision; end if;
 if new.configuration_draft is not null and (
  jsonb_typeof(new.configuration_draft) is distinct from 'object'
  or not public.valid_agent_communication(new.configuration_draft->'communication')
  or jsonb_typeof(new.configuration_draft->'instructions') is distinct from 'string'
  or coalesce(length(btrim(new.configuration_draft->>'instructions')),0) not between 1 and 8000
  or jsonb_typeof(new.configuration_draft->'baseRevision') is distinct from 'number'
  or (new.configuration_draft - array['instructions','communication','baseRevision'])<>'{}'::jsonb
 ) then raise exception 'invalid_agent_draft'; end if;
 return new;
end $$;
create trigger guard_agent_configuration before insert or update on public.ai_agents
 for each row execute function public.guard_agent_configuration();

create function public.record_agent_configuration() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='INSERT' or new.configuration_revision<>old.configuration_revision then
  insert into public.agent_configuration_versions(agent_id,revision,business_id,instructions,communication)
   values(new.id,new.configuration_revision,new.business_id,new.instructions,new.communication);
 end if;
 return new;
end $$;
create trigger record_agent_configuration after insert or update on public.ai_agents
 for each row execute function public.record_agent_configuration();

-- A confirmed owner operation or the authenticated manual form calls this same
-- boundary. A draft cannot change live behavior. Restore prepares a draft only.
create function public.save_agent_communication(p_business uuid,p_user uuid,p_agent uuid,p_expected timestamptz,p_mode text,p_values jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.ai_agents; saved public.agent_configuration_versions; draft jsonb;
begin
 perform public.assert_business_operator(p_business,p_user);
 perform 1 from public.businesses where id=p_business for update;
 select * into a from public.ai_agents where id=p_agent and business_id=p_business for update;
 if not found then raise exception 'agent_not_found'; end if;
 if a.updated_at is distinct from p_expected then raise exception 'stale_agent'; end if;
 if p_mode='draft' then
  if jsonb_typeof(p_values) is distinct from 'object' or (p_values-array['instructions','communication'])<>'{}'::jsonb
   or jsonb_typeof(p_values->'instructions') is distinct from 'string'
   or coalesce(length(btrim(p_values->>'instructions')),0) not between 1 and 8000
   or not public.valid_agent_communication(p_values->'communication') then raise exception 'invalid_agent_draft'; end if;
  draft:=p_values || jsonb_build_object('baseRevision',a.configuration_revision);
 elsif p_mode='restore' then
  select * into saved from public.agent_configuration_versions where agent_id=p_agent and business_id=p_business and revision=(p_values->>'revision')::bigint;
  if not found then raise exception 'configuration_not_found'; end if;
  draft:=jsonb_build_object('instructions',saved.instructions,'communication',saved.communication,'baseRevision',a.configuration_revision);
 elsif p_mode='publish' then
  if a.configuration_draft is null then raise exception 'missing_agent_draft'; end if;
  if (a.configuration_draft->>'baseRevision')::bigint<>a.configuration_revision then raise exception 'stale_agent_draft'; end if;
  update public.ai_agents set instructions=configuration_draft->>'instructions',communication=configuration_draft->'communication',
   configuration_draft=null,updated_at=greatest(clock_timestamp(),a.updated_at+interval '1 microsecond') where id=a.id returning * into a;
  return jsonb_build_object('revision',a.configuration_revision,'published',true,'active',a.is_active);
 elsif p_mode='discard' then draft:=null;
 else raise exception 'invalid_configuration_mode'; end if;
 update public.ai_agents set configuration_draft=draft,updated_at=greatest(clock_timestamp(),a.updated_at+interval '1 microsecond') where id=a.id;
 return jsonb_build_object('revision',a.configuration_revision,'published',false,'active',a.is_active);
end $$;
revoke all on function public.valid_agent_communication(jsonb),public.guard_agent_configuration(),public.record_agent_configuration(),public.save_agent_communication(uuid,uuid,uuid,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.valid_agent_communication(jsonb) to authenticated,service_role;
grant execute on function public.save_agent_communication(uuid,uuid,uuid,timestamptz,text,jsonb) to service_role;
alter function public.business_setup_status(uuid) rename to pre_communication_business_setup_status;
create function public.business_setup_status(p_business_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare base jsonb; policy text; signature text;
begin
 base:=pre_communication_business_setup_status(p_business_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'communication',communication) order by id),'[]'::jsonb)::text into policy from ai_agents where business_id=p_business_id and is_active;
 signature:=md5((base->>'signature')||policy);
 return base||jsonb_build_object('signature',signature,'tested',coalesce((select tested_signature=signature from business_setup where business_id=p_business_id),false));
end $$;
revoke all on function public.business_setup_status(uuid),public.pre_communication_business_setup_status(uuid) from public,anon,authenticated;
grant execute on function public.business_setup_status(uuid),public.pre_communication_business_setup_status(uuid) to service_role;
commit;
