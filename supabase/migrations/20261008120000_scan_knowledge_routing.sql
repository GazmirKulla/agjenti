-- Source-backed FAQ/information is stored in Knowledge in the scan transaction.
-- Existing answers are preserved; competing answers are imported inactive.
create function public.route_scan_knowledge(p_business uuid,p_entities jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e jsonb; t jsonb; b jsonb; entry_id uuid; inserted_ids jsonb:='[]'; routed integer:=0; held integer:=0; activate boolean;
begin
 perform 1 from businesses where id=p_business for update;
 if not found then raise exception 'unauthorized';end if;
 if coalesce(jsonb_typeof(p_entities),'')<>'array' or jsonb_array_length(p_entities)>60 then raise exception 'invalid_entities';end if;
 for e in select * from jsonb_array_elements(p_entities) loop
  if e->>'target'<>'knowledge' then raise exception 'invalid_target';end if;
  select f into t from jsonb_array_elements(e->'facts') f where f->>'field'='title';
  select f into b from jsonb_array_elements(e->'facts') f where f->>'field'='body';
  if coalesce(t->>'source','') not in ('website','instagram') or coalesce(b->>'source','') not in ('website','instagram')
   or coalesce(t->>'evidenceKind','text')='visual' or coalesce(b->>'evidenceKind','text')='visual'
   or length(btrim(coalesce(t->>'evidence','')))=0 or length(btrim(coalesce(b->>'evidence','')))=0
   or length(btrim(coalesce(t->>'value','')))=0 or length(btrim(coalesce(b->>'value','')))=0
   or length(t->>'value')>8000 or length(b->>'value')>8000 then raise exception 'invalid_value';end if;
  entry_id:=(e->>'id')::uuid;
  if exists(select 1 from knowledge_entries where id=entry_id and business_id<>p_business) then raise exception 'unauthorized_target';end if;
  -- Replays and equivalent answers from a second source never duplicate an entry.
  if exists(select 1 from knowledge_entries where business_id=p_business and intent_key is distinct from 'service'
    and lower(btrim(title))=lower(btrim(t->>'value')) and btrim(body)=btrim(b->>'value')) then routed:=routed+1;continue;end if;
  activate:=not exists(select 1 from knowledge_entries where business_id=p_business
    and lower(btrim(title))=lower(btrim(t->>'value')));
  if exists(select 1 from knowledge_entries where id=entry_id) then entry_id:=gen_random_uuid();end if;
  insert into knowledge_entries(id,business_id,title,body,is_active,intent_key)
   values(entry_id,p_business,btrim(t->>'value'),btrim(b->>'value'),activate,null);
  inserted_ids:=inserted_ids||jsonb_build_array(entry_id);
  routed:=routed+1;
  if not activate then held:=held+1;end if;
 end loop;
 return jsonb_build_object('insertedIds',inserted_ids,'count',routed,'inactiveCount',held);
end $$;

-- Rebase only our own insertions. Unrelated edits to products, agents or existing
-- knowledge must still trigger platform_changed when a user confirms a draft.
create function public.scan_knowledge_baseline(p_baseline jsonb,p_business uuid,p_ids jsonb) returns jsonb
language sql stable security definer set search_path=public as $$
 select case when p_baseline is null then null else jsonb_set(p_baseline,'{knowledge}',
  coalesce((select jsonb_agg(entry order by entry->>'id') from (
   select entry from jsonb_array_elements(coalesce(p_baseline->'knowledge','[]')) entry
   union all
   select to_jsonb(k) from knowledge_entries k where k.business_id=p_business and p_ids ? k.id::text
    and not exists(select 1 from jsonb_array_elements(coalesce(p_baseline->'knowledge','[]')) old where old->>'id'=k.id::text)
  ) entries),'[]'::jsonb)) end;
$$;

create function public.save_scanned_intelligence(p_business uuid,p_user uuid,p_revision integer,p_data jsonb,p_baseline jsonb,p_knowledge jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare saved integer; routed jsonb;
begin
 perform 1 from businesses where id=p_business for update;
 if not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized';end if;
 saved:=save_intelligence_draft(p_business,p_revision,p_data,p_baseline);
 routed:=route_scan_knowledge(p_business,p_knowledge);
 update business_intelligence set baseline=scan_knowledge_baseline(baseline,p_business,routed->'insertedIds') where business_id=p_business;
 update business_discovery set baseline=scan_knowledge_baseline(baseline,p_business,routed->'insertedIds') where business_id=p_business;
 return routed||jsonb_build_object('revision',saved,'draft',p_data);
end $$;

create function public.finish_scanned_business_discovery(p_job uuid,p_lease uuid,p_revision integer,p_draft jsonb,p_signals jsonb,p_knowledge jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare finished boolean; business uuid; routed jsonb;
begin
 finished:=finish_business_discovery(p_job,p_lease,p_revision,p_draft,p_signals);
 if not finished then return false;end if;
 select business_id into business from business_discovery_jobs where id=p_job;
 routed:=route_scan_knowledge(business,p_knowledge);
 update business_discovery set baseline=scan_knowledge_baseline(baseline,business,routed->'insertedIds') where business_id=business;
 update business_intelligence set baseline=scan_knowledge_baseline(baseline,business,routed->'insertedIds') where business_id=business;
 update business_discovery_jobs set checkpoint=checkpoint||jsonb_build_object('knowledgeCount',routed->'count','inactiveKnowledgeCount',routed->'inactiveCount') where id=p_job;
 return true;
end $$;

-- Route eligible entries left by older scans, without scanning again. The draft
-- and its baseline are changed atomically and protected by the existing revision.
create function public.route_discovery_knowledge(p_business uuid,p_user uuid,p_revision integer,p_draft jsonb,p_knowledge jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare routed jsonb;
begin
 perform 1 from businesses where id=p_business for update;
 if not(exists(select 1 from business_users where business_id=p_business and user_id=p_user) or exists(select 1 from platform_admins where user_id=p_user)) then raise exception 'unauthorized';end if;
 update business_discovery set draft=p_draft,revision=revision+1,updated_at=now() where business_id=p_business and revision=p_revision;
 if not found then raise exception 'stale_draft';end if;
 routed:=route_scan_knowledge(p_business,p_knowledge);
 update business_discovery set baseline=scan_knowledge_baseline(baseline,p_business,routed->'insertedIds') where business_id=p_business;
 update business_intelligence set baseline=scan_knowledge_baseline(baseline,p_business,routed->'insertedIds') where business_id=p_business;
 return routed;
end $$;

revoke all on function public.route_scan_knowledge(uuid,jsonb),public.scan_knowledge_baseline(jsonb,uuid,jsonb),public.save_scanned_intelligence(uuid,uuid,integer,jsonb,jsonb,jsonb),public.finish_scanned_business_discovery(uuid,uuid,integer,jsonb,jsonb,jsonb),public.route_discovery_knowledge(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.route_scan_knowledge(uuid,jsonb),public.scan_knowledge_baseline(jsonb,uuid,jsonb),public.save_scanned_intelligence(uuid,uuid,integer,jsonb,jsonb,jsonb),public.finish_scanned_business_discovery(uuid,uuid,integer,jsonb,jsonb,jsonb),public.route_discovery_knowledge(uuid,uuid,integer,jsonb,jsonb) to service_role;
