-- Platform admins can allow a business to keep up to two AI agents.
-- Default remains a single agent per business.

alter table public.businesses
  add column if not exists allow_multiple_agents boolean not null default false;

create or replace function public.enforce_ai_agent_limit()
returns trigger
language plpgsql
as $$
declare
  max_agents integer;
  current_count integer;
begin
  select case when allow_multiple_agents then 2 else 1 end
    into max_agents
  from public.businesses
  where id = new.business_id;

  if max_agents is null then
    raise exception 'business_not_found';
  end if;

  select count(*)::integer into current_count
  from public.ai_agents
  where business_id = new.business_id;

  if current_count >= max_agents then
    raise exception 'agent_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_ai_agent_limit on public.ai_agents;
create trigger enforce_ai_agent_limit
  before insert on public.ai_agents
  for each row execute function public.enforce_ai_agent_limit();
