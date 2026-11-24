-- The business's public profile, kept in one place: identity (description, activity), public contacts (phone,
-- email, website, social networks), location (address, map point, Google Maps link, directions) and opening hours
-- (weekly intervals, days closed, dated exceptions, a note). The agent reads it from here and the owner edits it in
-- Agjenti → Biznesi; nothing copies it. A field that is absent is unknown, never closed or unavailable.
--
-- Kept apart on purpose: the business name, logo and timezone stay on businesses (used by billing, invoices and the
-- calendar, so a configuration rollback does not change them); account, billing and notification contacts stay with
-- the account; booking availability stays in business_calendar_settings.hours. The website and Instagram read as
-- sources stay where the source scan keeps them and are offered in the profile as a visible suggestion.
--
-- The profile is part of the agent configuration (agent_configuration_snapshot 'profile'): it changes through
-- apply_agent_configuration (part profile.set) and comes back with Rikthe. No profile existed before, so every kept
-- version is given today's empty profile, which is what was true when it was taken.
--
-- Requires 20261125090000_agent_configuration_versions.sql.
-- Rollback: recreate agent_configuration_snapshot, apply_agent_configuration_change and revert_agent_configuration
-- from 20261125090000_agent_configuration_versions.sql, recreate the businesses trigger with its agent_behavior
-- condition, drop valid_business_profile and the columns public_profile, public_profile_updated_at.
begin;
set local lock_timeout='5s';

create function public.valid_business_profile(p jsonb) returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(p)='object' and p->'version'='1'::jsonb and length(p::text)<=20000
  and (p - array['version','identity','contacts','location','hours'])='{}'::jsonb
  and (not p ? 'identity' or (jsonb_typeof(p->'identity')='object' and ((p->'identity') - array['description','activity'])='{}'::jsonb))
  and (not p ? 'contacts' or (jsonb_typeof(p->'contacts')='object' and ((p->'contacts') - array['phone','email','website','socials'])='{}'::jsonb))
  and (not p ? 'location' or (jsonb_typeof(p->'location')='object' and ((p->'location') - array['address','lat','lng','maps_url','directions'])='{}'::jsonb))
  and (not p ? 'hours' or (jsonb_typeof(p->'hours')='object' and ((p->'hours') - array['weekly','closed_days','exceptions','note'])='{}'::jsonb)), false)
$$;
alter table public.businesses
 add column public_profile jsonb not null default '{"version":1}'::jsonb,
 add column public_profile_updated_at timestamptz not null default clock_timestamp();
alter table public.businesses add constraint valid_business_profile check (public.valid_business_profile(public_profile));

create or replace function public.agent_configuration_snapshot(p_business uuid) returns jsonb
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
  'profile', (select b.public_profile from public.businesses b where b.id=p_business),
  'services', coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'booking_enabled',s.booking_enabled) order by s.id)
    from public.booking_services s where s.business_id=p_business), '[]'::jsonb),
  'calendar', (select jsonb_build_object('agent_booking_enabled',c.agent_booking_enabled) from public.business_calendar_settings c where c.business_id=p_business),
  'training', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'kind',t.kind,'instruction',t.instruction,'customer_message',t.customer_message,
     'desired_response',t.desired_response,'workflow_id',t.workflow_id,'step_key',t.step_key,'visual_flow_id',t.visual_flow_id,
     'visual_node_id',t.visual_node_id,'is_active',t.is_active) order by t.id)
    from public.agent_training_memories t where t.business_id=p_business), '[]'::jsonb))
$$;


create or replace function public.apply_agent_configuration_change(p_business uuid, p_user uuid, c jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_id uuid; k public.knowledge_entries; a public.ai_agents; t public.agent_training_memories; s public.booking_services;
 v_text text; v_body text; v_comm jsonb; v_active boolean; v_ids jsonb; n integer;
begin
 if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'type') is distinct from 'string' then raise exception 'invalid_configuration_change'; end if;
 if c->>'type' not in ('calendar.agent_booking','behavior.set','profile.set') then
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
 when 'profile.set' then
  -- The whole public profile as the owner saw it change; the stamp guards a parallel edit.
  if not public.valid_business_profile(c->'profile') then raise exception 'invalid_configuration_change'; end if;
  if c ? 'expected' and (select public_profile_updated_at from public.businesses where id=p_business) is distinct from (c->>'expected')::timestamptz then raise exception 'stale_configuration_target'; end if;
  update public.businesses set public_profile=c->'profile', public_profile_updated_at=greatest(clock_timestamp(),public_profile_updated_at+interval '1 microsecond'), updated_at=clock_timestamp()
   where id=p_business and public_profile is distinct from c->'profile';
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

create or replace function public.revert_agent_configuration(p_business uuid, p_user uuid, p_request uuid, p_base bigint, p_revision bigint)
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
 if jsonb_typeof(s->'profile')='object' then
  update public.businesses set public_profile=s->'profile', public_profile_updated_at=greatest(clock_timestamp(),public_profile_updated_at+interval '1 microsecond'), updated_at=clock_timestamp()
   where id=p_business and public_profile is distinct from s->'profile';
 end if;
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

-- The deferred version trigger on businesses also watches the profile.
drop trigger track_agent_configuration on public.businesses;
create constraint trigger track_agent_configuration after update of agent_behavior, public_profile on public.businesses deferrable initially deferred
 for each row when (old.agent_behavior is distinct from new.agent_behavior or old.public_profile is distinct from new.public_profile)
 execute function public.track_agent_configuration();
create or replace function public.agent_configuration_label(p_table text) returns text language sql immutable set search_path=pg_catalog as $$
 select case p_table when 'knowledge_entries' then 'Ndryshim te Njohuritë' when 'agent_training_memories' then 'Ndryshim te Preferencat dhe shembujt'
  when 'ai_agents' then 'Ndryshim te udhëzimet' when 'booking_services' then 'Ndryshim te Shërbimet'
  when 'business_calendar_settings' then 'Ndryshim te Kalendari'
  when 'businesses' then 'Ndryshim te profili ose sjellja e Agjentit' else 'Ndryshim në konfigurim' end
$$;

-- Every kept version had no profile yet: give it the empty profile, so the first real change is the first difference.
update public.agent_configuration_snapshots s set snapshot=s.snapshot||jsonb_build_object('profile',b.public_profile)
 from public.businesses b where b.id=s.business_id and not s.snapshot ? 'profile';

revoke all on function public.valid_business_profile(jsonb) from public, anon;
grant execute on function public.valid_business_profile(jsonb) to authenticated, service_role;
revoke all on function public.agent_configuration_snapshot(uuid), public.apply_agent_configuration_change(uuid,uuid,jsonb),
 public.revert_agent_configuration(uuid,uuid,uuid,bigint,bigint) from public, anon, authenticated;
grant execute on function public.revert_agent_configuration(uuid,uuid,uuid,bigint,bigint) to service_role;

notify pgrst, 'reload schema';
commit;
