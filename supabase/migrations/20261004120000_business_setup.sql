-- Setup metadata only: no test messages, customers, or orders are persisted.
create table public.business_setup (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  tested_signature text,
  tested_at timestamptz,
  launched_at timestamptz,
  launch_mode text check (launch_mode in ('manual','automatic'))
);
alter table public.business_setup enable row level security;
revoke all on public.business_setup from anon, authenticated;
grant all on public.business_setup to service_role;

create function public.business_setup_status(p_business_id uuid)
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
    'types', (select jsonb_agg(to_jsonb(t) - 'created_at' order by t.id) from public.product_types t where t.business_id=p_business_id),
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
revoke all on function public.business_setup_status(uuid) from public, anon, authenticated;
grant execute on function public.business_setup_status(uuid) to service_role;

-- Atomic launch: recheck the current setup inside the transaction.
create function public.launch_business(p_business_id uuid, p_automatic boolean)
returns void language plpgsql security invoker set search_path = public as $$
declare s jsonb;
begin
  perform id from public.businesses where id=p_business_id for update;
  if not found then raise exception 'Business missing'; end if;
  s := public.business_setup_status(p_business_id);
  if not (s->>'connected')::boolean or not (s->>'agentReady')::boolean
    or not (s->>'tested')::boolean or (s->>'usableProducts')::integer=0
    or (s->>'unconfiguredProducts')::integer>0 then raise exception 'Setup incomplete'; end if;
  update public.businesses set auto_reply=p_automatic where id=p_business_id;
  insert into public.business_setup(business_id,launched_at,launch_mode)
  values(p_business_id,now(),case when p_automatic then 'automatic' else 'manual' end)
  on conflict(business_id) do update set launched_at=excluded.launched_at,launch_mode=excluded.launch_mode;
end;
$$;
revoke all on function public.launch_business(uuid,boolean) from public, anon, authenticated;
grant execute on function public.launch_business(uuid,boolean) to service_role;
