-- Knowledge keeps its context: the format it is written in (plain text or light Markdown with lists,
-- tables and headings), where it came from (the owner, the website, Instagram, a conversation, the
-- business profile, the agent's instructions) with the quote it was learned from and when, and when the
-- owner last changed it by hand (an entry the owner changed is never overwritten by a refresh).
--
-- route_scan_knowledge (every knowledge learned from Instagram or the website) is copied from
-- 20261008120000_scan_knowledge_routing.sql and stores the format and the source.
-- Additive; existing entries keep format 'plain' and no source ("i panjohur").
-- Rollback: recreate route_scan_knowledge from 20261008120000, then
--   alter table public.knowledge_entries drop column format, drop column source, drop column owner_edited_at;
begin;
set local lock_timeout='5s';

alter table public.knowledge_entries add column if not exists format text not null default 'plain';
alter table public.knowledge_entries add column if not exists source jsonb;
alter table public.knowledge_entries add column if not exists owner_edited_at timestamptz;
alter table public.knowledge_entries drop constraint if exists knowledge_entries_format_check;
alter table public.knowledge_entries add constraint knowledge_entries_format_check check (format in ('plain','markdown'));
alter table public.knowledge_entries drop constraint if exists knowledge_entries_source_check;
alter table public.knowledge_entries add constraint knowledge_entries_source_check check (source is null or (
  jsonb_typeof(source) = 'object' and source->>'kind' in ('owner','website','instagram','conversation','profile','instructions','assistant')
  and octet_length(source::text) <= 2000));

create or replace function public.route_scan_knowledge(p_business uuid,p_entities jsonb) returns jsonb
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
  -- Learned from a source: kept as written (light Markdown), with where it came from and the quote.
  insert into knowledge_entries(id,business_id,title,body,is_active,intent_key,format,source)
   values(entry_id,p_business,btrim(t->>'value'),btrim(b->>'value'),activate,null,'markdown',
    jsonb_strip_nulls(jsonb_build_object('kind',b->>'source','ref',nullif(left(b->>'sourceRef',300),''),
     'evidence',nullif(left(btrim(b->>'evidence'),600),''),'capturedAt',now())));
  inserted_ids:=inserted_ids||jsonb_build_array(entry_id);
  routed:=routed+1;
  if not activate then held:=held+1;end if;
 end loop;
 return jsonb_build_object('insertedIds',inserted_ids,'count',routed,'inactiveCount',held);
end $$;

notify pgrst, 'reload schema';
commit;
