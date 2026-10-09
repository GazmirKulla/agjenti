begin;
insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000081','agents-limit@example.test');
do $$
declare
  b uuid;
  first_id uuid;
begin
  perform complete_business_onboarding(
    '00000000-0000-4000-8000-000000000081',
    '{"name":"Agent limit","useCases":[]}',
    'Support'
  );
  select business_id into b
  from business_users
  where user_id = '00000000-0000-4000-8000-000000000081';

  if (select allow_multiple_agents from businesses where id = b) then
    raise exception 'Default should disallow multiple agents';
  end if;

  select id into first_id from ai_agents where business_id = b;
  if first_id is null then
    raise exception 'Onboarding should create the starter agent';
  end if;

  begin
    insert into ai_agents(business_id,name,instructions,is_active)
    values (b,'Second','Rules',false);
    raise exception 'Second agent allowed without flag';
  exception
    when others then
      if sqlerrm not like '%agent_limit_reached%' then raise; end if;
  end;

  update businesses set allow_multiple_agents = true where id = b;

  insert into ai_agents(business_id,name,instructions,is_active)
  values (b,'Second','Rules',false);

  begin
    insert into ai_agents(business_id,name,instructions,is_active)
    values (b,'Third','Rules',false);
    raise exception 'Third agent exceeded max of two';
  exception
    when others then
      if sqlerrm not like '%agent_limit_reached%' then raise; end if;
  end;

  if (select count(*) from ai_agents where business_id = b) <> 2 then
    raise exception 'Expected exactly two agents';
  end if;
end;
$$;
rollback;
