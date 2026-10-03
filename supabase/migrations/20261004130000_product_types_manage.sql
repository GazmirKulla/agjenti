-- Global product types (catalog) + template steps.
-- Business workflows attach to products, not to types.

alter table public.products
  add column if not exists workflow_id uuid references public.workflows (id) on delete set null;

-- Snapshot before mutating FKs.
create temporary table _old_product_types on commit drop as
select * from public.product_types;

create temporary table _old_product_links on commit drop as
select id as product_id, product_type_id as old_type_id, business_id
from public.products
where product_type_id is not null;

create temporary table _old_knowledge_links on commit drop as
select id as entry_id, product_type_id as old_type_id
from public.knowledge_entries
where product_type_id is not null;

-- Copy legacy type→workflow links onto products.
update public.products p
set workflow_id = t.workflow_id
from public.product_types t
where p.product_type_id = t.id
  and p.workflow_id is null
  and t.workflow_id is not null
  and exists (
    select 1 from public.workflows w
    where w.id = t.workflow_id and w.business_id = p.business_id
  );

alter table public.knowledge_entries drop constraint if exists knowledge_entries_product_type_fk;
alter table public.products drop constraint if exists products_product_type_id_fkey;

drop policy if exists "tenant select types" on public.product_types;
drop policy if exists "tenant write types" on public.product_types;
drop index if exists idx_product_types_external_key;

update public.products set product_type_id = null;
update public.knowledge_entries set product_type_id = null;

truncate public.product_types;

alter table public.product_types drop column if exists business_id;
alter table public.product_types drop column if exists workflow_id;
alter table public.product_types add column if not exists description text;
alter table public.product_types add column if not exists updated_at timestamptz not null default now();
alter table public.product_types add column if not exists sort_order integer not null default 0;
alter table public.product_types add column if not exists is_active boolean not null default true;

create unique index if not exists idx_product_types_external_key
  on public.product_types (lower(btrim(external_key)))
  where external_key is not null and length(btrim(external_key)) > 0;

create table if not exists public.product_type_steps (
  id uuid primary key default gen_random_uuid(),
  product_type_id uuid not null references public.product_types (id) on delete cascade,
  key text not null,
  position integer not null,
  kind text not null check (kind in ('choice', 'text', 'photo', 'customer', 'confirm')),
  required boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  unique (product_type_id, key),
  unique (product_type_id, position)
);

alter table public.product_type_steps enable row level security;
revoke all on public.product_type_steps from anon, authenticated;
grant select on public.product_type_steps to authenticated;
grant all on public.product_type_steps to service_role;

drop policy if exists "authenticated read type steps" on public.product_type_steps;
create policy "authenticated read type steps" on public.product_type_steps
  for select to authenticated using (true);

revoke all on public.product_types from anon, authenticated;
grant select on public.product_types to authenticated;
grant all on public.product_types to service_role;

drop policy if exists "authenticated read product types" on public.product_types;
create policy "authenticated read product types" on public.product_types
  for select to authenticated using (true);

insert into public.product_types (name, description, external_key, sort_order)
values
  (
    'Produkt standard',
    'Produkte të gatshme pa personalizim. Agjenti konfirmon produktin dhe mbledh adresën.',
    'standard',
    0
  ),
  (
    'Me variante',
    'Produkte me masa, ngjyra ose opsione të tjera. Agjenti mbledh zgjedhjet para adresës.',
    'variants',
    1
  ),
  (
    'Me personalizim',
    'Produkte me tekst, foto ose temë të personalizuar. Agjenti mbledh detajet dhe foton.',
    'personalized',
    2
  ),
  (
    'Shërbim',
    'Shërbime ose oferta pa stok fizik. Agjenti konfirmon shërbimin dhe mbledh kontaktin.',
    'service',
    3
  );

insert into public.product_type_steps (product_type_id, key, position, kind, required, config)
select t.id, s.key, s.position, s.kind, true, jsonb_build_object('label', s.label)
from public.product_types t
join (
  values
    ('standard', 'confirm_product', 0, 'confirm', 'Konfirmim'),
    ('standard', 'collect_customer', 1, 'customer', 'Adresa'),
    ('variants', 'collect_size', 0, 'choice', 'Madhësi'),
    ('variants', 'collect_color', 1, 'choice', 'Ngjyra'),
    ('variants', 'collect_customer', 2, 'customer', 'Adresa'),
    ('personalized', 'collect_theme', 0, 'text', 'Tema / teksti'),
    ('personalized', 'awaiting_photo', 1, 'photo', 'Foto'),
    ('personalized', 'collect_customer', 2, 'customer', 'Adresa'),
    ('service', 'confirm_product', 0, 'confirm', 'Konfirmim'),
    ('service', 'collect_customer', 1, 'customer', 'Adresa')
) as s(external_key, key, position, kind, label)
  on lower(t.external_key) = s.external_key;

-- Remap old tenant types → global catalog.
create temporary table _type_remap on commit drop as
select o.id as old_id, g.id as global_id
from _old_product_types o
join public.product_types g
  on o.external_key is not null
 and length(btrim(o.external_key)) > 0
 and lower(btrim(o.external_key)) = lower(btrim(g.external_key));

insert into _type_remap (old_id, global_id)
select o.id, g.id
from _old_product_types o
join public.product_types g
  on lower(btrim(o.name)) = lower(btrim(g.name))
where o.id not in (select old_id from _type_remap);

insert into _type_remap (old_id, global_id)
select o.id, g.id
from _old_product_types o
join public.product_types g on g.external_key = 'personalized'
where o.id not in (select old_id from _type_remap)
  and (
    lower(btrim(coalesce(o.external_key, ''))) in ('puzzle', 'personalized')
    or lower(btrim(o.name)) in ('puzzle', 'me personalizim')
  );

insert into _type_remap (old_id, global_id)
select o.id, g.id
from _old_product_types o
join public.product_types g on g.external_key = 'variants'
where o.id not in (select old_id from _type_remap)
  and (
    lower(btrim(coalesce(o.external_key, ''))) in ('tshirt', 'variants')
    or lower(btrim(o.name)) in ('bluzë', 'bluze', 'me variante')
  );

-- Fallback: any remaining old types map to "standard".
insert into _type_remap (old_id, global_id)
select o.id, g.id
from _old_product_types o
cross join public.product_types g
where g.external_key = 'standard'
  and o.id not in (select old_id from _type_remap);

update public.products p
set product_type_id = r.global_id
from _old_product_links l
join _type_remap r on r.old_id = l.old_type_id
where p.id = l.product_id;

update public.knowledge_entries k
set product_type_id = r.global_id
from _old_knowledge_links l
join _type_remap r on r.old_id = l.old_type_id
where k.id = l.entry_id;

alter table public.products
  add constraint products_product_type_id_fkey
  foreign key (product_type_id) references public.product_types (id) on delete set null;

alter table public.knowledge_entries
  add constraint knowledge_entries_product_type_fk
  foreign key (product_type_id) references public.product_types (id) on delete set null;

drop function if exists public.seed_default_product_types(uuid);

create or replace function public.complete_business_onboarding(p_user_id uuid, p_answers jsonb, p_instructions text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_business_id uuid;
  v_slug text;
  v_name text;
begin
  perform id from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Profile missing'; end if;
  if exists (select 1 from public.platform_admins where user_id = p_user_id) then
    raise exception 'Platform administrators use the admin workspace';
  end if;
  select b.slug into v_slug from public.business_users bu join public.businesses b on b.id = bu.business_id
    where bu.user_id = p_user_id order by b.name, b.id limit 1;
  if v_slug is not null then return v_slug; end if;
  if exists (select 1 from public.business_onboarding where user_id = p_user_id and completed_at is not null) then
    raise exception 'This account already completed onboarding. Contact an administrator.';
  end if;
  v_name := btrim(p_answers->>'name');
  if v_name is null or length(v_name) < 2 or length(v_name) > 100
    or jsonb_typeof(p_answers->'useCases') is distinct from 'array'
    or length(coalesce(p_instructions,'')) = 0 then raise exception 'Invalid onboarding answers'; end if;
  v_business_id := gen_random_uuid();
  v_slug := 'biznes-' || replace(v_business_id::text, '-', '');
  insert into public.businesses(id,name,slug,catalog_source,auto_reply)
    values(v_business_id,v_name,v_slug,'internal',false);
  insert into public.business_users(business_id,user_id,role) values(v_business_id,p_user_id,'owner');
  insert into public.ai_agents(business_id,name,instructions,is_active)
    values(v_business_id,'Agjenti i ' || v_name,p_instructions,false);
  insert into public.business_onboarding(user_id,business_id,answers,step,completed_at)
    values(p_user_id,v_business_id,p_answers,7,now())
    on conflict(user_id) do update set business_id=excluded.business_id, answers=excluded.answers,
      step=7, completed_at=now(), updated_at=now();
  return v_slug;
end;
$$;

create or replace function public.business_setup_status(p_business_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
with products as (
  select p.*,
    (length(btrim(p.name)) > 0 and p.price_amount >= 0 and length(btrim(p.currency)) > 0) as usable,
    (
      p.product_type_id is not null
      and exists (select 1 from public.product_types t where t.id = p.product_type_id and t.is_active)
      and exists (
        select 1
        from public.workflows w
        where w.id = p.workflow_id
          and w.business_id = p.business_id
          and exists (select 1 from public.workflow_steps s where s.workflow_id = w.id)
          and exists (
            select 1 from public.workflow_steps s
            where s.workflow_id = w.id
              and s.kind = 'customer'
              and s.position = (
                select max(last_step.position)
                from public.workflow_steps last_step
                where last_step.workflow_id = w.id
              )
          )
      )
    ) as configured
  from public.products p
  where p.business_id = p_business_id
), config as (
  select md5(jsonb_build_object(
    'products', (select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.id) from public.products p where p.business_id=p_business_id),
    'agents', (select jsonb_agg(to_jsonb(a) - 'created_at' - 'updated_at' order by a.id) from public.ai_agents a where a.business_id=p_business_id and a.is_active),
    'types', (select jsonb_agg(to_jsonb(t) - 'created_at' - 'updated_at' order by t.id) from public.product_types t where t.is_active),
    'steps', (select jsonb_agg(to_jsonb(s) order by s.workflow_id,s.position) from public.workflow_steps s join public.workflows w on w.id=s.workflow_id where w.business_id=p_business_id),
    'knowledge', (select jsonb_agg(to_jsonb(k) - 'created_at' - 'updated_at' order by k.id) from public.knowledge_entries k where k.business_id=p_business_id and k.is_active)
  )::text) as signature
)
select jsonb_build_object(
  'connected', exists(select 1 from public.instagram_connections where business_id=p_business_id and status='connected' and (expires_at is null or expires_at > now())),
  'productCount', (select count(*) from products),
  'usableProducts', (select count(*) from products where usable),
  'unconfiguredProducts', (select count(*) from products where not configured),
  'agentReady', exists(select 1 from public.ai_agents where business_id=p_business_id and is_active and length(btrim(instructions)) > 0),
  'signature', config.signature,
  'tested', coalesce((select tested_signature=config.signature from public.business_setup where business_id=p_business_id),false),
  'launched', exists(select 1 from public.business_setup where business_id=p_business_id and launched_at is not null)
) from config;
$$;
