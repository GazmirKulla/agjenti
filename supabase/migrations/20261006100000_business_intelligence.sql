-- Unified review state, provenance history and atomic application. Service-only writes.
create table public.business_intelligence (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 data jsonb not null default '{"entities":[],"conflicts":[],"missingInformation":[],"suggestedClarifications":[]}',
 revision integer not null default 0,
 baseline jsonb,
 updated_at timestamptz not null default now()
);
create table public.business_intelligence_sources (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete set null,
 source text not null check(source in ('audio','website','instagram','manual','ai_inferred')),
 reference text, transcript text, extracted jsonb,
 status text not null default 'pending' check(status in ('pending','completed','failed')),
 created_at timestamptz not null default now()
);
create index on public.business_intelligence_sources(business_id,created_at desc);
alter table public.business_intelligence enable row level security;
alter table public.business_intelligence_sources enable row level security;
create policy intelligence_member_read on public.business_intelligence for select to authenticated using (
 public.is_business_member(business_intelligence.business_id) or public.is_platform_admin());
create policy intelligence_source_read on public.business_intelligence_sources for select to authenticated using (
 public.is_business_member(business_intelligence_sources.business_id) or public.is_platform_admin());
grant select on public.business_intelligence,public.business_intelligence_sources to authenticated;
grant all on public.business_intelligence,public.business_intelligence_sources to service_role;

create function public.intelligence_snapshot(p_business uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'business',(select to_jsonb(b) from businesses b where b.id=p_business),
 'products',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from products p where p.business_id=p_business),'[]'),
 'agents',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from ai_agents a where a.business_id=p_business),'[]'),
 'knowledge',coalesce((select jsonb_agg(to_jsonb(k) order by k.id) from knowledge_entries k where k.business_id=p_business),'[]'),
 'workflows',coalesce((select jsonb_agg(to_jsonb(w)||jsonb_build_object('steps',(select jsonb_agg(to_jsonb(s) order by s.position) from workflow_steps s where s.workflow_id=w.id)) order by w.id) from workflows w where w.business_id=p_business),'[]'));
$$;
create function public.claim_intelligence_source(p_business uuid,p_user uuid,p_source text) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 perform 1 from businesses where id=p_business for update;
 if not found or not (exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 if (select count(*) from business_intelligence_sources where business_id=p_business and created_at>now()-interval '24 hours')>=30 then raise exception 'daily_limit'; end if;
 if exists(select 1 from business_intelligence_sources where business_id=p_business and status='pending' and created_at>now()-interval '3 minutes') then raise exception 'busy'; end if;
 update business_intelligence_sources set status='failed' where business_id=p_business and status='pending';
 insert into business_intelligence_sources(business_id,user_id,source) values(p_business,p_user,p_source) returning id into v_id;
 return v_id;
end $$;
create function public.save_intelligence_draft(p_business uuid,p_revision integer,p_data jsonb,p_baseline jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare v_revision integer;
begin
 perform 1 from businesses where id=p_business for update;
 insert into business_intelligence(business_id,baseline) values(p_business,p_baseline) on conflict do nothing;
 select revision into v_revision from business_intelligence where business_id=p_business for update;
 if v_revision<>p_revision then raise exception 'stale_draft'; end if;
 update business_intelligence set data=p_data,revision=revision+1,updated_at=now() where business_id=p_business;
 return v_revision+1;
end $$;

create function public.apply_intelligence(p_business uuid,p_user uuid,p_revision integer,p_data jsonb,p_entities jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare v_state business_intelligence; e jsonb; f jsonb; v jsonb; v_id uuid; line text; i integer; body text;
begin
 perform 1 from businesses where id=p_business for update;
 if not (exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized'; end if;
 select * into v_state from business_intelligence where business_id=p_business for update;
 if not found or v_state.revision<>p_revision then raise exception 'stale_draft'; end if;
 perform 1 from products where business_id=p_business for update;
 perform 1 from ai_agents where business_id=p_business for update;
 perform 1 from knowledge_entries where business_id=p_business for update;
 perform 1 from workflows where business_id=p_business for update;
 if v_state.baseline is distinct from intelligence_snapshot(p_business) then raise exception 'platform_changed'; end if;
 if jsonb_array_length(p_entities)=0 or jsonb_array_length(p_entities)>60 then raise exception 'invalid_entities'; end if;
 for e in select * from jsonb_array_elements(p_entities) loop
  v_id:=(e->>'id')::uuid; v:='{}'; body:='';
  for f in select * from jsonb_array_elements(e->'facts') loop
   v:=v||jsonb_build_object(f->>'field',f->'value');
   if f->>'value' is not null then body:=body||(f->>'field')||': '||(f->>'value')||E'\n'; end if;
  end loop;
  case e->>'target'
   when 'product' then
    if exists(select 1 from products where id=v_id and business_id<>p_business) then raise exception 'unauthorized_target'; end if;
    insert into products(id,business_id,name,description,price_amount,currency,is_active,source,image_url)
     values(v_id,p_business,v->>'name',body,nullif(v->>'price','')::numeric,v->>'currency',false,'manual',nullif(v->>'imageUrl',''))
     on conflict(id) do update set name=excluded.name,description=excluded.description,price_amount=excluded.price_amount,currency=excluded.currency,image_url=excluded.image_url,updated_at=now();
   when 'agent' then
    if exists(select 1 from ai_agents where id=v_id and business_id<>p_business) then raise exception 'unauthorized_target'; end if;
    insert into ai_agents(id,business_id,name,instructions,is_active) values(v_id,p_business,'Agjenti AI',body,false)
     on conflict(id) do update set instructions=excluded.instructions,updated_at=now();
   when 'workflow' then
    if exists(select 1 from workflows where id=v_id and business_id<>p_business) then raise exception 'unauthorized_target'; end if;
    insert into workflows(id,business_id,name) values(v_id,p_business,v->>'name') on conflict(id) do update set name=excluded.name;
    delete from workflow_steps where workflow_id=v_id;
    i:=0;
    foreach line in array string_to_array(v->>'steps',E'\n') loop
     if btrim(line)<>'' then
      insert into workflow_steps(workflow_id,key,position,kind,required,config) values(v_id,'step_'||(i+1),i,split_part(line,'|',1),true,jsonb_build_object('label',substring(line from position('|' in line)+1)));
      i:=i+1;
     end if;
    end loop;
   when 'profile' then
    if exists(select 1 from knowledge_entries where id=v_id and business_id<>p_business) then raise exception 'unauthorized_target'; end if;
    update businesses set name=coalesce(nullif(v->>'name',''),name),updated_at=now() where id=p_business;
    insert into knowledge_entries(id,business_id,title,body,is_active,intent_key) values(v_id,p_business,'Profili i biznesit',body,true,'business_profile')
     on conflict(id) do update set body=excluded.body,updated_at=now() where knowledge_entries.business_id=p_business;
   when 'knowledge','service' then
    if exists(select 1 from knowledge_entries where id=v_id and business_id<>p_business) then raise exception 'unauthorized_target'; end if;
    insert into knowledge_entries(id,business_id,title,body,is_active,intent_key) values(v_id,p_business,coalesce(v->>'title',v->>'name'),case when e->>'target'='knowledge' then v->>'body' else body end,true,case when e->>'target'='service' then 'service' else null end)
     on conflict(id) do update set title=excluded.title,body=excluded.body,updated_at=now();
   else raise exception 'invalid_target';
  end case;
 end loop;
 update business_intelligence set data=p_data,revision=revision+1,baseline=intelligence_snapshot(p_business),updated_at=now() where business_id=p_business;
 return p_revision+1;
end $$;
revoke all on function public.intelligence_snapshot(uuid),public.claim_intelligence_source(uuid,uuid,text),public.save_intelligence_draft(uuid,integer,jsonb,jsonb),public.apply_intelligence(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.intelligence_snapshot(uuid),public.claim_intelligence_source(uuid,uuid,text),public.save_intelligence_draft(uuid,integer,jsonb,jsonb),public.apply_intelligence(uuid,uuid,integer,jsonb,jsonb) to service_role;

-- Bridge the existing onboarding transaction into the same business data model.
create function public.bridge_onboarding_intelligence() returns trigger language plpgsql security definer set search_path=public as $$
declare facts jsonb:='[]'; entry record; value jsonb; field text; entity jsonb; source_kind text;
begin
 if new.business_id is null or new.completed_at is null then return new; end if;
 if exists(select 1 from business_intelligence where business_id=new.business_id) then return new; end if;
 source_kind:=case when new.answers ? 'audioReview' then 'audio' else 'manual' end;
 for entry in select * from jsonb_each(new.answers || coalesce(new.answers->'details','{}'::jsonb)) loop
  field:=case entry.key when 'name' then 'name' when 'businessType' then 'businessType' when 'businessCategory' then 'category' when 'businessDescription' then 'description' else null end;
  if field is not null and entry.value<>'null'::jsonb then
   facts:=facts||jsonb_build_array(jsonb_build_object('field',field,'value',entry.value,'source',case when new.answers->'audioReview'->'corrections' ? entry.key then 'manual' else source_kind end,'sourceRef','onboarding','confidence',coalesce(new.answers->'audioReview'->'confidence'->entry.key,'1'::jsonb),'evidence',null,'createdAt',now(),'updatedAt',now(),'confirmedByUser',true));
  end if;
 end loop;
 entity:=jsonb_build_object('id',gen_random_uuid(),'target','profile','facts',facts);
 insert into business_intelligence(business_id,data,baseline) values(new.business_id,jsonb_build_object('entities',jsonb_build_array(entity),'conflicts','[]'::jsonb,'missingInformation','[]'::jsonb,'suggestedClarifications','[]'::jsonb),intelligence_snapshot(new.business_id));
 insert into business_intelligence_sources(business_id,user_id,source,reference,transcript,extracted,status,created_at)
 select new.business_id,new.user_id,'audio','onboarding:'||a.id,a.transcript,
 jsonb_build_object('entities',jsonb_build_array(jsonb_build_object('target','profile','facts',coalesce((select jsonb_agg(jsonb_build_object('field',case k.key when 'businessDescription' then 'description' when 'businessCategory' then 'category' else k.key end,'value',k.value->'value','confidence',k.value->'confidence','evidence',k.value->'evidence','source','audio','sourceRef','onboarding:'||a.id,'createdAt',a.created_at,'updatedAt',a.created_at,'confirmedByUser',false)) from jsonb_each(a.extracted) k where k.key in ('name','businessType','businessDescription','businessCategory')),'[]')))),
 'completed',a.created_at from onboarding_audio_attempts a where a.user_id=new.user_id and a.status='completed';
 return new;
end $$;
create trigger onboarding_intelligence_bridge after insert or update of completed_at,business_id on business_onboarding for each row execute function bridge_onboarding_intelligence();
revoke all on function public.bridge_onboarding_intelligence() from public,anon,authenticated;
-- Backfill existing confirmed onboarding without replacing any business draft.
update business_onboarding set completed_at=completed_at where completed_at is not null and business_id is not null;

create table public.business_intelligence_revisions (
 business_id uuid not null references businesses(id) on delete cascade,
 revision integer not null,
 data jsonb not null,
 created_at timestamptz not null default now(),
 primary key(business_id,revision)
);
alter table public.business_intelligence_revisions enable row level security;
create policy intelligence_revision_read on public.business_intelligence_revisions for select to authenticated using (
 public.is_business_member(business_intelligence_revisions.business_id) or public.is_platform_admin());
grant select on public.business_intelligence_revisions to authenticated;
grant all on public.business_intelligence_revisions to service_role;
create function public.audit_intelligence_revision() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into business_intelligence_revisions(business_id,revision,data) values(new.business_id,new.revision,new.data) on conflict do nothing;
 return new;
end $$;
create trigger intelligence_revision_audit after insert or update on business_intelligence for each row execute function audit_intelligence_revision();
revoke all on function public.audit_intelligence_revision() from public,anon,authenticated;
