-- Testing the agent before going live is recommended, no longer required:
-- automatic replies need a connected channel, an active agent with
-- instructions and something to answer from (as before), not a test.
begin;

create or replace function public.launch_business(p_business_id uuid, p_automatic boolean)
returns void language plpgsql set search_path=public as $$
declare s jsonb;
begin
 perform id from businesses where id=p_business_id for update;if not found then raise exception 'Business missing';end if;
 s:=business_setup_status(p_business_id);
 if not(s->>'connected')::boolean or not(s->>'agentReady')::boolean
 or ((s->>'usableProducts')::integer=0 and (s->>'catalogCount')::integer=0 and (s->>'serviceCount')::integer=0 and ((s->>'productCount')::integer>0 or (s->>'knowledgeCount')::integer=0))
 or (s->>'unconfiguredProducts')::integer>0 then raise exception 'Setup incomplete';end if;
 update businesses set auto_reply=p_automatic where id=p_business_id;
 insert into business_setup(business_id,launched_at,launch_mode) values(p_business_id,now(),case when p_automatic then 'automatic' else 'manual' end)
 on conflict(business_id) do update set launched_at=excluded.launched_at,launch_mode=excluded.launch_mode;
end $$;

commit;
