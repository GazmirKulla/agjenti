-- Richer catalog fields for staff UI and the AI agent.

alter table public.products
  add column if not exists description text,
  add column if not exists sku text,
  add column if not exists is_active boolean not null default true,
  add column if not exists image_url text;

create unique index if not exists idx_products_sku
  on public.products (business_id, lower(btrim(sku)))
  where sku is not null and length(btrim(sku)) > 0;

-- Setup counts only active products so inactive rows do not block launch.
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
    and p.is_active
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
