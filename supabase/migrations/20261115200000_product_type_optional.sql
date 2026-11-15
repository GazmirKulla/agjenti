-- The product type is a template of order steps (standard, with variants, personalized),
-- not a condition for the catalog: a priced product is active without it, and it no longer
-- decides whether an active product counts as configured for setup. A new product without
-- a type gets one from its own data ("Me variante" when it has variants or choices, else
-- "Produkt standard"), and the existing ones without a type are filled the same way.
-- The setup signature is unchanged: it reads only active products, which all have a type.
begin;

create or replace function public.product_business_setup_status(p_business_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
with products as (
  select p.*,
    (length(btrim(p.name)) > 0 and p.price_amount >= 0 and length(btrim(p.currency)) > 0) as usable,
    (
      exists (
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
    'products', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'price_amount', p.price_amount,
          'currency', p.currency,
          'product_type_id', p.product_type_id,
          'workflow_id', p.workflow_id,
          'is_active', p.is_active,
          'sku', p.sku
        ) order by p.id
      ), '[]'::jsonb)
      from public.products p
      where p.business_id = p_business_id
        and p.is_active
    ),
    'agents', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'instructions', a.instructions,
          'is_active', a.is_active
        ) order by a.id
      ), '[]'::jsonb)
      from public.ai_agents a
      where a.business_id = p_business_id
        and a.is_active
    ),
    'steps', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'workflow_id', s.workflow_id,
          'key', s.key,
          'kind', s.kind,
          'position', s.position
        ) order by s.workflow_id, s.position
      ), '[]'::jsonb)
      from public.workflow_steps s
      join public.workflows w on w.id = s.workflow_id
      where w.business_id = p_business_id
    ),
    'knowledge', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', k.id,
          'title', k.title,
          'body', k.body,
          'intent_key', k.intent_key
        ) order by k.id
      ), '[]'::jsonb)
      from public.knowledge_entries k
      where k.business_id = p_business_id
        and k.is_active
    )
  )::text) as signature
)
select jsonb_build_object(
  'connected', exists(
    select 1 from public.instagram_connections
    where business_id = p_business_id
      and status = 'connected'
      and (expires_at is null or expires_at > now())
  ),
  'productCount', (select count(*) from products),
  'usableProducts', (select count(*) from products where usable),
  'unconfiguredProducts', (select count(*) from products where not configured),
  'agentReady', exists(
    select 1 from public.ai_agents
    where business_id = p_business_id
      and is_active
      and length(btrim(instructions)) > 0
  ),
  'signature', config.signature,
  'tested', coalesce(
    (
      select tested_signature = config.signature
      from public.business_setup
      where business_id = p_business_id
    ),
    false
  ),
  'launched', exists(
    select 1 from public.business_setup
    where business_id = p_business_id
      and launched_at is not null
  )
) from config;
$$;

-- "Me variante" when the product has variant rows or a list of choices, else "Produkt standard".
create or replace function public.product_type_from_data(p_attributes jsonb, p_has_variants boolean)
returns uuid language sql stable set search_path = public as $$
 select id from public.product_types
 where is_active and external_key = case
   when p_has_variants or exists (
     select 1 from jsonb_each(coalesce(p_attributes, '{}'::jsonb)) e
     -- SQL does not short-circuit: the length is read only for a list.
     where case when jsonb_typeof(e.value) = 'array' then jsonb_array_length(e.value) else 0 end > 1)
   then 'variants' else 'standard' end
 order by sort_order, id limit 1
$$;

create or replace function public.default_product_type() returns trigger
language plpgsql set search_path = public as $$
begin
 if new.product_type_id is null then new.product_type_id := public.product_type_from_data(new.attributes, false); end if;
 return new;
end $$;
drop trigger if exists default_product_type on public.products;
create trigger default_product_type before insert on public.products
 for each row execute function public.default_product_type();

-- Variants are saved after their product: one still on the standard template moves to the
-- variants one. Only the type changes (not updated_at), so an open editor is not invalidated.
create or replace function public.product_type_after_variants() returns trigger
language plpgsql security definer set search_path = public as $$
begin
 update public.products p set product_type_id = public.product_type_from_data(p.attributes, true)
 where p.id = new.product_id
   and p.product_type_id = (select id from public.product_types where external_key = 'standard' and is_active order by sort_order, id limit 1);
 return new;
end $$;
drop trigger if exists product_type_after_variants on public.product_variants;
create trigger product_type_after_variants after insert on public.product_variants
 for each row execute function public.product_type_after_variants();

-- Existing products without a type (all drafts); one that cannot be written keeps none.
do $$
declare r record;
begin
 for r in select p.id, p.attributes, exists(select 1 from public.product_variants v where v.product_id = p.id) as has_variants
   from public.products p where p.product_type_id is null loop
  begin
   update public.products set product_type_id = public.product_type_from_data(r.attributes, r.has_variants)
   where id = r.id and product_type_id is null;
  exception when others then null;
  end;
 end loop;
end $$;

revoke all on function public.product_type_from_data(jsonb, boolean), public.default_product_type(), public.product_type_after_variants() from public, anon, authenticated;

commit;
