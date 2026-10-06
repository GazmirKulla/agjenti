create table public.catalogs (
 id uuid primary key default gen_random_uuid(),business_id uuid not null references businesses(id) on delete cascade,
 title text not null,source_type text not null check(source_type in ('pdf','text','website','url')),source_url text,storage_path text,
 description text not null default '',index_metadata jsonb not null default '{}',metadata jsonb not null default '{}',ai_summary text not null default '',coverage text not null default '',
 use_when text[] not null default '{}',qualification_fields text[] not null default '{}',active boolean not null default false,
 index_status text not null default 'pending' check(index_status in ('pending','indexing','review','ready','failed')),
 index_error text,confirmed_at timestamptz,revision integer not null default 0,
 share_token text not null unique default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),last_indexed_at timestamptz,
 check(not active or (index_status='ready' and confirmed_at is not null))
);
create index on catalogs(business_id,index_status,active);
create table public.catalog_sections (
 id uuid primary key default gen_random_uuid(),catalog_id uuid not null references catalogs(id) on delete cascade,
 business_id uuid not null references businesses(id) on delete cascade,
 heading text not null,body text not null,page integer,keywords text[] not null default '{}',embedding double precision[],position integer not null,
 unique(catalog_id,position),check(embedding is null or array_length(embedding,1)=256)
);
create index on catalog_sections(business_id,catalog_id);
alter table catalogs enable row level security;alter table catalog_sections enable row level security;
create policy catalog_read on catalogs for select to authenticated using (is_business_member(business_id) or is_platform_admin());
create policy section_read on catalog_sections for select to authenticated using (is_business_member(business_id) or is_platform_admin());
grant select on catalogs,catalog_sections to authenticated;grant all on catalogs,catalog_sections to service_role;
create function public.finish_catalog_index(p_id uuid,p_business uuid,p_revision integer,p_metadata jsonb,p_summary text,p_coverage text,p_sections jsonb) returns boolean language plpgsql security definer set search_path=public as $$
declare s jsonb;i integer:=0;
begin
 perform 1 from catalogs where id=p_id and business_id=p_business and revision=p_revision and index_status='indexing' for update;
 if not found then return false;end if;
 if jsonb_array_length(p_sections)<1 or jsonb_array_length(p_sections)>40 then raise exception 'invalid_sections';end if;
 delete from catalog_sections where catalog_id=p_id;
 for s in select * from jsonb_array_elements(p_sections) loop
 insert into catalog_sections(catalog_id,business_id,heading,body,page,keywords,embedding,position) values(p_id,p_business,s->>'heading',s->>'text',(s->>'page')::integer,array(select jsonb_array_elements_text(s->'keywords')),case when jsonb_typeof(s->'embedding')='array' then array(select jsonb_array_elements_text(s->'embedding'))::double precision[] else null end,i);i:=i+1;
 end loop;
 update catalogs set metadata=case when metadata='{}'::jsonb then p_metadata else metadata end,index_metadata=p_metadata,ai_summary=p_summary,coverage=p_coverage,index_status='review',active=false,confirmed_at=null,index_error=null,last_indexed_at=now(),updated_at=now(),revision=revision+1 where id=p_id;
 return true;
end $$;
create function public.search_catalog_sections(p_business uuid,p_query double precision[],p_text text) returns table(catalog_id uuid,heading text,body text,page integer,semantic double precision) language sql stable security definer set search_path=public as $$
 with scored as (
 select s.catalog_id,s.heading,s.body,s.page,
 case when cardinality(p_query)=256 and cardinality(s.embedding)=256 then
 (select sum(a*b)/nullif(sqrt(sum(a*a))*sqrt(sum(b*b)),0) from unnest(p_query,s.embedding) v(a,b))
 else ts_rank_cd(to_tsvector('simple',s.heading||' '||s.body),plainto_tsquery('simple',p_text))::double precision end as semantic
 from catalog_sections s join catalogs c on c.id=s.catalog_id and c.business_id=s.business_id
 where s.business_id=p_business and c.active and c.index_status='ready' and c.confirmed_at is not null
 ), best_per_catalog as (
 select distinct on (catalog_id) catalog_id,heading,body,page,semantic from scored order by catalog_id,semantic desc nulls last
 ) select * from best_per_catalog order by semantic desc nulls last limit 500;

$$;
revoke all on function finish_catalog_index(uuid,uuid,integer,jsonb,text,text,jsonb),search_catalog_sections(uuid,double precision[],text) from public,anon,authenticated;
grant execute on function finish_catalog_index(uuid,uuid,integer,jsonb,text,text,jsonb),search_catalog_sections(uuid,double precision[],text) to service_role;
-- Private documents are shared only through the active catalog's revocable link.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('business-catalogs','business-catalogs',false,10485760,array['application/pdf','text/plain','text/markdown']) on conflict(id) do nothing;

-- Claim and limit indexing per tenant, including retries and concurrent requests.
create table catalog_index_runs(business_id uuid not null references businesses(id) on delete cascade,created_at timestamptz not null default now());
alter table catalog_index_runs enable row level security;
create index on catalog_index_runs(business_id,created_at);
create function claim_catalog_index(p_id uuid,p_business uuid) returns setof catalogs language plpgsql security definer set search_path=public as $$
begin
 perform 1 from businesses where id=p_business for update;
 if (select count(*) from catalog_index_runs where business_id=p_business and created_at>now()-interval '1 hour')>=10 then raise exception 'index_limit';end if;
 return query update catalogs set index_status='indexing',active=false,confirmed_at=null,index_error=null,updated_at=now(),revision=revision+1
 where id=p_id and business_id=p_business and (index_status<>'indexing' or updated_at<now()-interval '5 minutes') returning *;
 if found then insert into catalog_index_runs(business_id) values(p_business);end if;
end $$;
revoke all on function claim_catalog_index(uuid,uuid) from public,anon,authenticated;
grant execute on function claim_catalog_index(uuid,uuid) to service_role;

-- Keep the existing product setup checks and fingerprint unchanged for SMBs.
alter function business_setup_status(uuid) rename to product_business_setup_status;
create function business_setup_status(p_business_id uuid) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare base jsonb;docs jsonb;signature text;catalog_count integer;service_count integer;
begin
 base:=product_business_setup_status(p_business_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision) order by id),'[]') into docs from catalogs where business_id=p_business_id and active and index_status='ready' and confirmed_at is not null;
 catalog_count:=jsonb_array_length(docs);
 select count(*) into service_count from knowledge_entries where business_id=p_business_id and is_active and intent_key='service' and length(btrim(body))>0;
 signature:=case when catalog_count>0 then md5((base->>'signature')||docs::text) else base->>'signature' end;
 return base||jsonb_build_object('catalogCount',catalog_count,'serviceCount',service_count,'signature',signature,'tested',coalesce((select tested_signature=signature from business_setup where business_id=p_business_id),false));
end $$;
revoke all on function business_setup_status(uuid) from public,anon,authenticated;
grant execute on function business_setup_status(uuid) to service_role;
create or replace function launch_business(p_business_id uuid,p_automatic boolean) returns void language plpgsql security invoker set search_path=public as $$
declare s jsonb;
begin
 perform id from businesses where id=p_business_id for update;if not found then raise exception 'Business missing';end if;
 s:=business_setup_status(p_business_id);
 if not(s->>'connected')::boolean or not(s->>'agentReady')::boolean or not(s->>'tested')::boolean
 or ((s->>'usableProducts')::integer=0 and (s->>'catalogCount')::integer=0 and (s->>'serviceCount')::integer=0)
 or (s->>'unconfiguredProducts')::integer>0 then raise exception 'Setup incomplete';end if;
 update businesses set auto_reply=p_automatic where id=p_business_id;
 insert into business_setup(business_id,launched_at,launch_mode) values(p_business_id,now(),case when p_automatic then 'automatic' else 'manual' end)
 on conflict(business_id) do update set launched_at=excluded.launched_at,launch_mode=excluded.launch_mode;
end $$;
