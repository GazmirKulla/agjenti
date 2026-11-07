-- Every successful OpenAI request made on behalf of a business, aggregated per day and model.
create table if not exists public.ai_usage_daily (
  business_id uuid not null references public.businesses(id) on delete cascade,
  day date not null,
  model text not null,
  calls integer not null default 0 check (calls >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  updated_at timestamptz not null default now(),
  primary key (business_id, day, model)
);

alter table public.ai_usage_daily enable row level security;

drop policy if exists ai_usage_daily_owner_read on public.ai_usage_daily;
create policy ai_usage_daily_owner_read on public.ai_usage_daily
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.business_users
      where business_id = ai_usage_daily.business_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

-- Days follow the businesses' local calendar so a month closes at local midnight.
create or replace function public.record_ai_usage(
  p_business uuid,
  p_model text,
  p_input bigint,
  p_output bigint
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage_daily as usage (business_id, day, model, calls, input_tokens, output_tokens)
  values (
    p_business,
    (now() at time zone 'Europe/Tirane')::date,
    left(coalesce(nullif(p_model, ''), 'unknown'), 120),
    1,
    greatest(coalesce(p_input, 0), 0),
    greatest(coalesce(p_output, 0), 0)
  )
  on conflict (business_id, day, model) do update set
    calls = usage.calls + 1,
    input_tokens = usage.input_tokens + excluded.input_tokens,
    output_tokens = usage.output_tokens + excluded.output_tokens,
    updated_at = now();
$$;

revoke all on function public.record_ai_usage(uuid, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_ai_usage(uuid, text, bigint, bigint) to service_role;

create or replace function public.ai_usage_month(p_business uuid)
returns table (calls bigint, input_tokens bigint, output_tokens bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(calls), 0)::bigint, coalesce(sum(input_tokens), 0)::bigint, coalesce(sum(output_tokens), 0)::bigint
  from public.ai_usage_daily
  where business_id = p_business
    and day >= date_trunc('month', now() at time zone 'Europe/Tirane')::date;
$$;

revoke all on function public.ai_usage_month(uuid) from public, anon, authenticated;
grant execute on function public.ai_usage_month(uuid) to service_role;
