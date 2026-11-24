-- The agent's configuration is changed as one whole and kept in at most three restorable versions per
-- business: the current one and the two before it.
--
-- Included (what decides what the agent says and may do): knowledge entries (not the service mirrors,
-- intent_key 'service', which follow booking_services), every agent's instructions and communication,
-- businesses.agent_behavior, the training lessons and examples, and two permissions kept in the catalog:
-- booking_services.booking_enabled (the agent takes bookings for that service) and
-- business_calendar_settings.agent_booking_enabled. Knowledge waiting as an undecided source proposal is not
-- configuration yet and stays out until the owner decides it.
-- Excluded: orders, bookings, conversations, customers, stock, prices and the content of products and
-- services; product publication (the offer itself); agent identity and activation (agent.manage); the
-- advanced workflows, which keep their own versions and publication.
--
-- apply_agent_configuration writes every part of one proposal in one transaction, checked against the
-- version it was prepared on and against each object's own stamp; a repeated request returns its first
-- result. revert_agent_configuration brings a kept version back as a new version, or nothing at all.
-- Every other writer of these fields (the service and calendar forms, onboarding, source scans) records a
-- version in its own transaction through the triggers below, so the three-version limit and the history hold
-- for every entry point. agent_configuration_audit keeps one line per version, without content, after a
-- version leaves the three restorable ones.
--
-- Requires 20261124170000_agent_communication_apply.sql. agent_configuration_versions (instruction-only
-- revisions) stays as the earlier audit and is not offered as a full configuration.
-- Rollback: drop the triggers track_agent_configuration (on the six tables), the functions
-- apply_agent_configuration, apply_agent_configuration_change, revert_agent_configuration,
-- record_agent_configuration_version, agent_configuration_snapshot, track_agent_configuration,
-- agent_configuration_label, and the tables agent_configuration_snapshots,
-- agent_configuration_requests, agent_configuration_audit. No existing row is changed by this migration.
begin;
set local lock_timeout='5s';

create table public.agent_configuration_snapshots (
 business_id uuid not null references public.businesses(id) on delete cascade,
 revision bigint not null check (revision > 0),
 snapshot jsonb not null,
 source text not null,
 summary text not null default '',
 created_by uuid,
 created_at timestamptz not null default clock_timestamp(),
 primary key (business_id, revision)
);
create table public.agent_configuration_requests (
 business_id uuid not null references public.businesses(id) on delete cascade,
 request_id uuid not null,
 fingerprint text not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key (business_id, request_id)
);
create table public.agent_configuration_audit (
 id bigint generated always as identity primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 revision bigint not null,
 source text not null,
 summary text not null default '',
 changes jsonb not null default '[]',
 created_by uuid,
 created_at timestamptz not null default clock_timestamp()
);
create index agent_configuration_audit_business on public.agent_configuration_audit(business_id, created_at desc);
alter table public.agent_configuration_snapshots enable row level security;
alter table public.agent_configuration_requests enable row level security;
alter table public.agent_configuration_audit enable row level security;
revoke all on public.agent_configuration_snapshots, public.agent_configuration_requests, public.agent_configuration_audit from public, anon, authenticated;
grant select on public.agent_configuration_snapshots, public.agent_configuration_audit to service_role;

-- The configuration as it is now, ordered so that two equal configurations compare equal. Provenance metadata
-- (knowledge_entries.source: where an entry came from, when a page last showed it) is not configuration and does
-- not make a version; an entry brought back after deletion is marked as written by the owner.
create function public.agent_configuration_snapshot(p_business uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 with pending as (
  select jsonb_array_elements_text(j.checkpoint->'review'->'knowledgeIds') as id
  from public.business_discovery_jobs j
  where j.business_id=p_business and j.status='completed' and j.checkpoint->'review'->>'status'='pending'
 )
 select jsonb_build_object(
  'knowledge', coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'title',k.title,'body',k.body,'intent_key',k.intent_key,
     'is_active',k.is_active,'format',k.format,'sort_order',k.sort_order) order by k.id)
    from public.knowledge_entries k where k.business_id=p_business and k.intent_key is distinct from 'service'
    and (k.is_active or k.id::text not in (select id from pending where id is not null))), '[]'::jsonb),
  'agents', coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'instructions',a.instructions,'communication',a.communication) order by a.id)
    from public.ai_agents a where a.business_id=p_business), '[]'::jsonb),
  'behavior', (select coalesce(b.agent_behavior,'{}'::jsonb) from public.businesses b where b.id=p_business),
  'services', coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'booking_enabled',s.booking_enabled) order by s.id)
    from public.booking_services s where s.business_id=p_business), '[]'::jsonb),
  'calendar', (select jsonb_build_object('agent_booking_enabled',c.agent_booking_enabled) from public.business_calendar_settings c where c.business_id=p_business),
  'training', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'kind',t.kind,'instruction',t.instruction,'customer_message',t.customer_message,
     'desired_response',t.desired_response,'workflow_id',t.workflow_id,'step_key',t.step_key,'visual_flow_id',t.visual_flow_id,
     'visual_node_id',t.visual_node_id,'is_active',t.is_active) order by t.id)
    from public.agent_training_memories t where t.business_id=p_business), '[]'::jsonb))
$$;

-- A new version when the configuration differs from the newest kept one; only the three newest stay.
create function public.record_agent_configuration_version(p_business uuid, p_user uuid, p_source text, p_summary text, p_changes jsonb default '[]')
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare snap jsonb; latest public.agent_configuration_snapshots; next_revision bigint;
begin
 -- A business being deleted keeps no versions (its rows cascade away in the same statement).
 if not exists(select 1 from public.businesses where id=p_business) then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('agent_configuration:'||p_business::text, 0));
 snap:=public.agent_configuration_snapshot(p_business);
 select * into latest from public.agent_configuration_snapshots where business_id=p_business order by revision desc limit 1;
 if found and latest.snapshot=snap then return jsonb_build_object('revision',latest.revision,'created',false); end if;
 next_revision:=coalesce(latest.revision,0)+1;
 insert into public.agent_configuration_snapshots(business_id,revision,snapshot,source,summary,created_by)
  values(p_business,next_revision,snap,p_source,left(coalesce(p_summary,''),2000),p_user);
 delete from public.agent_configuration_snapshots where business_id=p_business and revision<=next_revision-3;
 insert into public.agent_configuration_audit(business_id,revision,source,summary,changes,created_by)
  values(p_business,next_revision,p_source,left(coalesce(p_summary,''),2000),coalesce(p_changes,'[]'::jsonb),p_user);
 return jsonb_build_object('revision',next_revision,'created',true);
end $$;

create function public.agent_configuration_label(p_table text) returns text language sql immutable set search_path=pg_catalog as $$
 select case p_table when 'knowledge_entries' then 'Ndryshim te Njohuritë' when 'agent_training_memories' then 'Ndryshim te Preferencat dhe shembujt'
  when 'ai_agents' then 'Ndryshim te udhëzimet' when 'booking_services' then 'Ndryshim te Shërbimet'
  when 'business_calendar_settings' then 'Ndryshim te Kalendari'
  when 'businesses' then 'Ndryshim te sjellja e Agjentit' else 'Ndryshim në konfigurim' end
$$;

-- Writers outside apply_agent_configuration record a version in their own transaction, at its end (deferred),
-- when the transaction's final state is known: a source scan that inserts proposals and marks them pending in
-- the same transaction therefore records nothing, and a bulk write is one version. Once per business and
-- transaction; equal configurations never make a version.
create function public.track_agent_configuration() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare b uuid; flag text;
begin
 if tg_table_name='businesses' then b:=new.id;
 elsif tg_op='DELETE' then b:=old.business_id;
 else b:=new.business_id; end if;
 flag:='agjenti.configuration_seen_'||replace(b::text,'-','');
 if coalesce(current_setting(flag, true),'')='1' then return null; end if;
 perform set_config(flag,'1',true);
 perform public.record_agent_configuration_version(b,null,'system',public.agent_configuration_label(tg_table_name));
 return null;
end $$;

do $$
declare t text;
begin
 foreach t in array array['knowledge_entries','agent_training_memories','ai_agents','booking_services','business_calendar_settings'] loop
  execute format('create constraint trigger track_agent_configuration after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.track_agent_configuration()', t);
 end loop;
end $$;
create constraint trigger track_agent_configuration after update of agent_behavior on public.businesses deferrable initially deferred
 for each row when (old.agent_behavior is distinct from new.agent_behavior) execute function public.track_agent_configuration();

-- One part of a proposal. Every part names its object and, when it changes an existing one, the stamp it
-- was prepared on; a different stamp means someone changed it meanwhile and nothing is applied.
create function public.apply_agent_configuration_change(p_business uuid, p_user uuid, c jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_id uuid; k public.knowledge_entries; a public.ai_agents; t public.agent_training_memories; s public.booking_services;
 v_text text; v_body text; v_comm jsonb; v_active boolean; v_ids jsonb; n integer;
begin
 if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'type') is distinct from 'string' then raise exception 'invalid_configuration_change'; end if;
 if c->>'type'<>'calendar.agent_booking' and c->>'type'<>'behavior.set' then
  begin v_id:=(c->>'id')::uuid; exception when others then raise exception 'invalid_configuration_change'; end;
  if v_id is null then raise exception 'invalid_configuration_change'; end if;
 end if;
 case c->>'type'
 when 'knowledge.save' then
  v_text:=btrim(coalesce(c->>'title','')); v_body:=btrim(coalesce(c->>'body',''));
  if length(v_text) not between 1 and 8000 or length(v_body) not between 1 and 8000 or c->>'intent_key'='service'
   or (c ? 'is_active' and jsonb_typeof(c->'is_active')<>'boolean') then raise exception 'invalid_configuration_change'; end if;
  select * into k from public.knowledge_entries where id=v_id for update;
  if found then
   if k.business_id<>p_business or k.intent_key='service' then raise exception 'configuration_target_missing'; end if;
   if c ? 'expected' and k.updated_at is distinct from (c->>'expected')::timestamptz then raise exception 'stale_configuration_target'; end if;
   update public.knowledge_entries set title=v_text, body=v_body, format='markdown', is_active=coalesce((c->>'is_active')::boolean,k.is_active),
    owner_edited_at=case when coalesce((c->>'owner')::boolean,false) then clock_timestamp() else owner_edited_at end,
    updated_at=greatest(clock_timestamp(),k.updated_at+interval '1 microsecond') where id=v_id;
  else
   if c->>'expected' is not null then raise exception 'stale_configuration_target'; end if;
   insert into public.knowledge_entries(id,business_id,title,body,intent_key,is_active,format,source)
    values(v_id,p_business,v_text,v_body,nullif(c->>'intent_key',''),coalesce((c->>'is_active')::boolean,true),'markdown',
     coalesce(c->'source',jsonb_build_object('kind','owner','capturedAt',clock_timestamp())));
  end if;
 when 'knowledge.active' then
  if jsonb_typeof(c->'is_active')<>'boolean' then raise exception 'invalid_configuration_change'; end if;
  select * into k from public.knowledge_entries where id=v_id and business_id=p_business and intent_key is distinct from 'service' for update;
  if not found then raise exception 'configuration_target_missing'; end if;
  if c ? 'expected' and k.updated_at is distinct from (c->>'expected')::timestamptz then raise exception 'stale_configuration_target'; end if;
  update public.knowledge_entries set is_active=(c->>'is_active')::boolean, updated_at=greatest(clock_timestamp(),k.updated_at+interval '1 microsecond') where id=v_id;
 when 'knowledge.delete' then
  select * into k from public.knowledge_entries where id=v_id and business_id=p_business and intent_key is distinct from 'service' for update;
  if not found then raise exception 'configuration_target_missing'; end if;
  if c ? 'expected' and k.updated_at is distinct from (c->>'expected')::timestamptz then raise exception 'stale_configuration_target'; end if;
  delete from public.knowledge_entries where id=v_id;
 when 'agent.update' then
  select * into a from public.ai_agents where id=v_id and business_id=p_business for update;
  if not found then raise exception 'configuration_target_missing'; end if;
  if c ? 'expected' and a.updated_at is distinct from (c->>'expected')::timestamptz then raise exception 'stale_configuration_target'; end if;
  v_text:=btrim(coalesce(c->>'instructions',a.instructions)); v_comm:=coalesce(c->'communication',a.communication);
  if length(v_text) not between 1 and 8000 or not public.valid_agent_communication(v_comm) then raise exception 'invalid_configuration_change'; end if;
  update public.ai_agents set instructions=v_text, communication=v_comm, updated_at=greatest(clock_timestamp(),a.updated_at+interval '1 microsecond') where id=v_id;
 when 'agent.draft' then
  select * into a from public.ai_agents where id=v_id and business_id=p_business for update;
  if not found then raise exception 'configuration_target_missing'; end if;
  if c ? 'expected' and a.updated_at is distinct from (c->>'expected')::timestamptz then raise exception 'stale_configuration_target'; end if;
  if a.configuration_draft is null then raise exception 'stale_configuration_target'; end if;
  if c->>'action'='apply' then
   if (a.configuration_draft->>'baseRevision')::bigint<>a.configuration_revision then raise exception 'stale_agent_draft'; end if;
   update public.ai_agents set instructions=configuration_draft->>'instructions', communication=configuration_draft->'communication', configuration_draft=null,
    updated_at=greatest(clock_timestamp(),a.updated_at+interval '1 microsecond') where id=v_id;
  elsif c->>'action'='discard' then
   update public.ai_agents set configuration_draft=null, updated_at=greatest(clock_timestamp(),a.updated_at+interval '1 microsecond') where id=v_id;
  else raise exception 'invalid_configuration_change'; end if;
 when 'behavior.set' then
  if (c ? 'voice' and jsonb_typeof(c->'voice')<>'boolean') or (c ? 'escalation' and coalesce(c->>'escalation','') not in ('handoff','notify','off'))
   or (c-'type'-'voice'-'escalation')<>'{}'::jsonb then raise exception 'invalid_configuration_change'; end if;
  update public.businesses set agent_behavior=coalesce(agent_behavior,'{}'::jsonb)||(c-'type'), updated_at=clock_timestamp() where id=p_business;
 when 'service.booking' then
  if jsonb_typeof(c->'booking_enabled')<>'boolean' then raise exception 'invalid_configuration_change'; end if;
  select * into s from public.booking_services where id=v_id and business_id=p_business for update;
  if not found then raise exception 'configuration_target_missing'; end if;
  if c ? 'expected' and s.updated_at is distinct from (c->>'expected')::timestamptz then raise exception 'stale_configuration_target'; end if;
  update public.booking_services set booking_enabled=(c->>'booking_enabled')::boolean, updated_at=greatest(clock_timestamp(),s.updated_at+interval '1 microsecond') where id=v_id;
 when 'calendar.agent_booking' then
  if jsonb_typeof(c->'enabled')<>'boolean' then raise exception 'invalid_configuration_change'; end if;
  update public.business_calendar_settings set agent_booking_enabled=(c->>'enabled')::boolean, updated_at=clock_timestamp() where business_id=p_business;
  get diagnostics n=row_count;
  if n=0 then raise exception 'calendar_missing'; end if;
 when 'training.save' then
  if coalesce(c->>'kind','') not in ('style','example','workflow') or length(btrim(coalesce(c->>'instruction',''))) not between 1 and 1500 then raise exception 'invalid_configuration_change'; end if;
  select * into t from public.agent_training_memories where id=v_id for update;
  if found then
   if t.business_id<>p_business then raise exception 'configuration_target_missing'; end if;
   if c ? 'expected_revision' and t.revision<>(c->>'expected_revision')::integer then raise exception 'stale_configuration_target'; end if;
   update public.agent_training_memories set kind=c->>'kind', instruction=btrim(c->>'instruction'), customer_message=coalesce(c->>'customer_message',''),
    desired_response=coalesce(c->>'desired_response',''), workflow_id=(c->>'workflow_id')::uuid, step_key=c->>'step_key',
    visual_flow_id=c->>'visual_flow_id', visual_node_id=c->>'visual_node_id', is_active=coalesce((c->>'is_active')::boolean,t.is_active), updated_by=p_user where id=v_id;
  else
   if c->>'expected_revision' is not null then raise exception 'stale_configuration_target'; end if;
   insert into public.agent_training_memories(id,business_id,kind,instruction,customer_message,desired_response,workflow_id,step_key,visual_flow_id,visual_node_id,is_active,source,created_by,updated_by)
    values(v_id,p_business,c->>'kind',btrim(c->>'instruction'),coalesce(c->>'customer_message',''),coalesce(c->>'desired_response',''),(c->>'workflow_id')::uuid,c->>'step_key',
     c->>'visual_flow_id',c->>'visual_node_id',coalesce((c->>'is_active')::boolean,true),coalesce(c->>'source','manual'),p_user,p_user);
  end if;
 when 'training.active' then
  if jsonb_typeof(c->'is_active')<>'boolean' then raise exception 'invalid_configuration_change'; end if;
  select * into t from public.agent_training_memories where id=v_id and business_id=p_business for update;
  if not found then raise exception 'configuration_target_missing'; end if;
  if c ? 'expected_revision' and t.revision<>(c->>'expected_revision')::integer then raise exception 'stale_configuration_target'; end if;
  update public.agent_training_memories set is_active=(c->>'is_active')::boolean, updated_by=p_user where id=v_id;
 when 'training.delete' then
  select * into t from public.agent_training_memories where id=v_id and business_id=p_business for update;
  if not found then raise exception 'configuration_target_missing'; end if;
  if c ? 'expected_revision' and t.revision<>(c->>'expected_revision')::integer then raise exception 'stale_configuration_target'; end if;
  delete from public.agent_training_memories where id=v_id;
 when 'proposal.decide' then
  -- A source proposal: decided once, against the content the owner reviewed; the decision is kept on the proposal.
  if coalesce(c->>'decision','') not in ('accept','reject') or c->>'expected' is null then raise exception 'invalid_configuration_change'; end if;
  perform 1 from public.business_discovery_jobs where business_id=p_business and status='completed'
   and checkpoint->'review'->>'status'='pending' and checkpoint->'review'->'knowledgeIds' ? v_id::text for update;
  if not found then raise exception 'proposal_not_pending'; end if;
  select * into k from public.knowledge_entries where id=v_id and business_id=p_business and not is_active for update;
  if not found or k.updated_at is distinct from (c->>'expected')::timestamptz then raise exception 'stale_configuration_target'; end if;
  if c->>'decision'='accept' then
   v_text:=btrim(coalesce(c->>'title',k.title)); v_body:=btrim(coalesce(c->>'body',k.body));
   if length(v_text) not between 2 and 500 or length(v_body) not between 2 and 8000 then raise exception 'invalid_configuration_change'; end if;
   update public.knowledge_entries set is_active=true, title=v_text, body=v_body,
    owner_edited_at=case when v_text<>k.title or v_body<>k.body then clock_timestamp() else owner_edited_at end,
    updated_at=greatest(clock_timestamp(),k.updated_at+interval '1 microsecond') where id=v_id;
  else
   delete from public.knowledge_entries where id=v_id;
  end if;
  update public.business_discovery_jobs set checkpoint=jsonb_set(jsonb_set(checkpoint,'{review,knowledgeIds}',
    coalesce((select jsonb_agg(x) from jsonb_array_elements(checkpoint->'review'->'knowledgeIds') x where x<>to_jsonb(v_id::text)),'[]'::jsonb)),
    '{review,decisions}', coalesce(checkpoint->'review'->'decisions','{}'::jsonb)||jsonb_build_object(v_id::text,jsonb_build_object('decision',c->>'decision','at',clock_timestamp(),'by',p_user))),
    updated_at=clock_timestamp()
   where business_id=p_business and status='completed' and checkpoint->'review'->>'status'='pending' and checkpoint->'review'->'knowledgeIds' ? v_id::text;
 else raise exception 'invalid_configuration_change';
 end case;
end $$;

create function public.apply_agent_configuration(p_business uuid, p_user uuid, p_request uuid, p_base bigint, p_changes jsonb, p_source text, p_summary text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_fingerprint text; prior public.agent_configuration_requests; v_current bigint; c jsonb; v_result jsonb;
begin
 perform public.assert_business_operator(p_business,p_user);
 if p_request is null or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 60
  or coalesce(p_source,'') not in ('owner','assistant','sources','conversations','memory') then raise exception 'invalid_configuration_change'; end if;
 perform pg_advisory_xact_lock(hashtextextended('agent_configuration:'||p_business::text, 0));
 v_fingerprint:=md5(p_changes::text||'|'||coalesce(p_base::text,''));
 select * into prior from public.agent_configuration_requests where business_id=p_business and request_id=p_request;
 if found then
  if prior.fingerprint<>v_fingerprint then raise exception 'configuration_request_conflict'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select coalesce(max(revision),0) into v_current from public.agent_configuration_snapshots where business_id=p_business;
 if p_base is not null and p_base<>v_current then raise exception 'stale_configuration'; end if;
 for c in select value from jsonb_array_elements(p_changes) loop perform public.apply_agent_configuration_change(p_business,p_user,c); end loop;
 v_result:=public.record_agent_configuration_version(p_business,p_user,p_source,p_summary,
  (select jsonb_agg(jsonb_build_object('type',x->>'type','id',x->>'id')) from jsonb_array_elements(p_changes) x));
 insert into public.agent_configuration_requests(business_id,request_id,fingerprint,result) values(p_business,p_request,v_fingerprint,v_result);
 return v_result;
end $$;

-- A kept version becomes the configuration again, as a new version. Every object it names must still exist;
-- otherwise nothing changes. Entries added after it are switched off, never deleted, so a later version can
-- still bring them back. Orders, bookings and every other operational row are not read or written.
create function public.revert_agent_configuration(p_business uuid, p_user uuid, p_request uuid, p_base bigint, p_revision bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_fingerprint text; prior public.agent_configuration_requests; v_current bigint; s jsonb; x jsonb; v_result jsonb; n integer;
begin
 perform public.assert_business_operator(p_business,p_user);
 if p_request is null or p_revision is null then raise exception 'invalid_configuration_change'; end if;
 perform pg_advisory_xact_lock(hashtextextended('agent_configuration:'||p_business::text, 0));
 v_fingerprint:=md5('revert|'||p_revision::text||'|'||coalesce(p_base::text,''));
 select * into prior from public.agent_configuration_requests where business_id=p_business and request_id=p_request;
 if found then
  if prior.fingerprint<>v_fingerprint then raise exception 'configuration_request_conflict'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select coalesce(max(revision),0) into v_current from public.agent_configuration_snapshots where business_id=p_business;
 if p_base is not null and p_base<>v_current then raise exception 'stale_configuration'; end if;
 if p_revision>=v_current then raise exception 'configuration_version_current'; end if;
 select snapshot into s from public.agent_configuration_snapshots where business_id=p_business and revision=p_revision;
 if not found then raise exception 'configuration_version_missing'; end if;
 -- Everything the version names must still be here, or no part is restored.
 if exists(select 1 from jsonb_array_elements(s->'agents') a where not exists(select 1 from public.ai_agents where id=(a->>'id')::uuid and business_id=p_business))
  or exists(select 1 from jsonb_array_elements(s->'services') v where not exists(select 1 from public.booking_services where id=(v->>'id')::uuid and business_id=p_business))
  or exists(select 1 from jsonb_array_elements(s->'knowledge') v join public.knowledge_entries k on k.id=(v->>'id')::uuid where k.business_id<>p_business or k.intent_key='service')
  or exists(select 1 from jsonb_array_elements(s->'training') v join public.agent_training_memories t on t.id=(v->>'id')::uuid where t.business_id<>p_business)
  or (jsonb_typeof(s->'calendar')='object' and not exists(select 1 from public.business_calendar_settings where business_id=p_business))
 then raise exception 'configuration_target_missing'; end if;
 for x in select value from jsonb_array_elements(s->'knowledge') loop
  insert into public.knowledge_entries(id,business_id,title,body,intent_key,is_active,format,source,sort_order)
   values((x->>'id')::uuid,p_business,x->>'title',x->>'body',x->>'intent_key',(x->>'is_active')::boolean,coalesce(x->>'format','markdown'),coalesce(x->'source','{"kind":"owner"}'::jsonb),coalesce((x->>'sort_order')::integer,0))
  on conflict (id) do update set title=excluded.title, body=excluded.body, is_active=excluded.is_active, format=excluded.format,
   updated_at=greatest(clock_timestamp(),public.knowledge_entries.updated_at+interval '1 microsecond')
  where public.knowledge_entries.business_id=p_business;
 end loop;
 update public.knowledge_entries set is_active=false, updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
  where business_id=p_business and is_active and intent_key is distinct from 'service'
  and id::text not in (select v->>'id' from jsonb_array_elements(s->'knowledge') v);
 for x in select value from jsonb_array_elements(s->'agents') loop
  update public.ai_agents set instructions=x->>'instructions', communication=x->'communication', updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
   where id=(x->>'id')::uuid and business_id=p_business and (instructions is distinct from x->>'instructions' or communication is distinct from x->'communication');
 end loop;
 update public.businesses set agent_behavior=s->'behavior', updated_at=clock_timestamp() where id=p_business and agent_behavior is distinct from s->'behavior' and s->'behavior' is not null;
 for x in select value from jsonb_array_elements(s->'services') loop
  update public.booking_services set booking_enabled=(x->>'booking_enabled')::boolean, updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
   where id=(x->>'id')::uuid and business_id=p_business and booking_enabled is distinct from (x->>'booking_enabled')::boolean;
 end loop;
 if jsonb_typeof(s->'calendar')='object' then
  update public.business_calendar_settings set agent_booking_enabled=(s->'calendar'->>'agent_booking_enabled')::boolean, updated_at=clock_timestamp()
   where business_id=p_business and agent_booking_enabled is distinct from (s->'calendar'->>'agent_booking_enabled')::boolean;
 end if;
 for x in select value from jsonb_array_elements(s->'training') loop
  insert into public.agent_training_memories(id,business_id,kind,instruction,customer_message,desired_response,workflow_id,step_key,visual_flow_id,visual_node_id,is_active,source,created_by,updated_by)
   values((x->>'id')::uuid,p_business,x->>'kind',x->>'instruction',coalesce(x->>'customer_message',''),coalesce(x->>'desired_response',''),(x->>'workflow_id')::uuid,x->>'step_key',
    x->>'visual_flow_id',x->>'visual_node_id',(x->>'is_active')::boolean,'manual',p_user,p_user)
  on conflict (id) do update set kind=excluded.kind, instruction=excluded.instruction, customer_message=excluded.customer_message, desired_response=excluded.desired_response,
   workflow_id=excluded.workflow_id, step_key=excluded.step_key, visual_flow_id=excluded.visual_flow_id, visual_node_id=excluded.visual_node_id, is_active=excluded.is_active, updated_by=p_user
  where public.agent_training_memories.business_id=p_business;
 end loop;
 update public.agent_training_memories set is_active=false, updated_by=p_user
  where business_id=p_business and is_active and id::text not in (select v->>'id' from jsonb_array_elements(s->'training') v);
 v_result:=public.record_agent_configuration_version(p_business,p_user,'revert','U rikthye versioni '||p_revision::text,'[]'::jsonb);
 insert into public.agent_configuration_requests(business_id,request_id,fingerprint,result) values(p_business,p_request,v_fingerprint,v_result);
 return v_result||jsonb_build_object('restored',p_revision);
end $$;

-- The baseline: each business's configuration as it is today, as version 1.
insert into public.agent_configuration_snapshots(business_id,revision,snapshot,source,summary)
 select b.id,1,public.agent_configuration_snapshot(b.id),'baseline','Konfigurimi në kalimin te versionet e plota' from public.businesses b;
insert into public.agent_configuration_audit(business_id,revision,source,summary)
 select b.id,1,'baseline','Konfigurimi në kalimin te versionet e plota' from public.businesses b;

revoke all on function public.agent_configuration_snapshot(uuid), public.record_agent_configuration_version(uuid,uuid,text,text,jsonb),
 public.agent_configuration_label(text), public.track_agent_configuration(),
 public.apply_agent_configuration_change(uuid,uuid,jsonb), public.apply_agent_configuration(uuid,uuid,uuid,bigint,jsonb,text,text),
 public.revert_agent_configuration(uuid,uuid,uuid,bigint,bigint) from public, anon, authenticated;
grant execute on function public.apply_agent_configuration(uuid,uuid,uuid,bigint,jsonb,text,text), public.revert_agent_configuration(uuid,uuid,uuid,bigint,bigint) to service_role;

notify pgrst, 'reload schema';
commit;
