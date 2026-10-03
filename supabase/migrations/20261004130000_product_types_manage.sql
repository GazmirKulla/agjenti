-- Product types bridge catalog products and order workflows.
-- Add admin-facing fields and a reusable seed for empty tenants.

alter table public.product_types
  add column if not exists description text,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_product_types_external_key
  on public.product_types (business_id, lower(btrim(external_key)))
  where external_key is not null and length(btrim(external_key)) > 0;

create or replace function public.seed_default_product_types(p_business_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_created integer := 0;
  v_workflow_id uuid;
  v_type jsonb;
  v_step jsonb;
begin
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'Business missing';
  end if;

  for v_type in
    select value
    from jsonb_array_elements('[
      {
        "name": "Produkt standard",
        "external_key": "standard",
        "description": "Produkte të gatshme pa personalizim. Agjenti konfirmon produktin dhe mbledh adresën.",
        "workflow_name": "Workflow – Produkt standard",
        "steps": [
          {"key": "confirm_product", "position": 0, "kind": "confirm", "label": "Konfirmim"},
          {"key": "collect_customer", "position": 1, "kind": "customer", "label": "Adresa"}
        ]
      },
      {
        "name": "Me variante",
        "external_key": "variants",
        "description": "Produkte me masa, ngjyra ose opsione të tjera. Agjenti mbledh zgjedhjet para adresës.",
        "workflow_name": "Workflow – Me variante",
        "steps": [
          {"key": "collect_size", "position": 0, "kind": "choice", "label": "Madhësi"},
          {"key": "collect_color", "position": 1, "kind": "choice", "label": "Ngjyra"},
          {"key": "collect_customer", "position": 2, "kind": "customer", "label": "Adresa"}
        ]
      },
      {
        "name": "Me personalizim",
        "external_key": "personalized",
        "description": "Produkte me tekst, foto ose temë të personalizuar. Agjenti mbledh detajet dhe foton.",
        "workflow_name": "Workflow – Me personalizim",
        "steps": [
          {"key": "collect_theme", "position": 0, "kind": "text", "label": "Tema / teksti"},
          {"key": "awaiting_photo", "position": 1, "kind": "photo", "label": "Foto"},
          {"key": "collect_customer", "position": 2, "kind": "customer", "label": "Adresa"}
        ]
      },
      {
        "name": "Shërbim",
        "external_key": "service",
        "description": "Shërbime ose oferta pa stok fizik. Agjenti konfirmon shërbimin dhe mbledh kontaktin.",
        "workflow_name": "Workflow – Shërbim",
        "steps": [
          {"key": "confirm_product", "position": 0, "kind": "confirm", "label": "Konfirmim"},
          {"key": "collect_customer", "position": 1, "kind": "customer", "label": "Adresa"}
        ]
      }
    ]'::jsonb)
  loop
    if exists (
      select 1
      from public.product_types
      where business_id = p_business_id
        and lower(btrim(external_key)) = lower(v_type->>'external_key')
    ) then
      continue;
    end if;

    insert into public.workflows (business_id, name)
    values (p_business_id, v_type->>'workflow_name')
    returning id into v_workflow_id;

    for v_step in select value from jsonb_array_elements(v_type->'steps')
    loop
      insert into public.workflow_steps (workflow_id, key, position, kind, required, config)
      values (
        v_workflow_id,
        v_step->>'key',
        (v_step->>'position')::integer,
        v_step->>'kind',
        true,
        jsonb_build_object('label', v_step->>'label')
      );
    end loop;

    insert into public.product_types (
      business_id,
      name,
      description,
      external_key,
      workflow_id
    )
    values (
      p_business_id,
      v_type->>'name',
      v_type->>'description',
      v_type->>'external_key',
      v_workflow_id
    );

    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.seed_default_product_types(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_product_types(uuid) to service_role;

do $$
declare
  bid uuid;
begin
  for bid in
    select b.id
    from public.businesses b
    where not exists (
      select 1 from public.product_types t where t.business_id = b.id
    )
  loop
    perform public.seed_default_product_types(bid);
  end loop;
end;
$$;

create or replace function public.business_setup_status(p_business_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
with products as (
  select p.*, (length(btrim(p.name)) > 0 and p.price_amount >= 0 and length(btrim(p.currency)) > 0) as usable,
    exists(select 1 from public.product_types t join public.workflows w on w.id=t.workflow_id and w.business_id=p.business_id
      where t.id=p.product_type_id and t.business_id=p.business_id
      and exists(select 1 from public.workflow_steps s where s.workflow_id=w.id)
      and exists(select 1 from public.workflow_steps s where s.workflow_id=w.id and s.kind='customer' and s.position=(select max(last_step.position) from public.workflow_steps last_step where last_step.workflow_id=w.id))) as configured
  from public.products p where p.business_id=p_business_id
), config as (
  select md5(jsonb_build_object(
    'products', (select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.id) from public.products p where p.business_id=p_business_id),
    'agents', (select jsonb_agg(to_jsonb(a) - 'created_at' - 'updated_at' order by a.id) from public.ai_agents a where a.business_id=p_business_id and a.is_active),
    'types', (select jsonb_agg(to_jsonb(t) - 'created_at' - 'updated_at' order by t.id) from public.product_types t where t.business_id=p_business_id),
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
  perform public.seed_default_product_types(v_business_id);
  insert into public.business_onboarding(user_id,business_id,answers,step,completed_at)
    values(p_user_id,v_business_id,p_answers,7,now())
    on conflict(user_id) do update set business_id=excluded.business_id, answers=excluded.answers,
      step=7, completed_at=now(), updated_at=now();
  return v_slug;
end;
$$;
