-- Disposable database only; no provider calls, fixtures roll back.
begin;
do $$
declare b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 conn uuid; c uuid; ch text; age integer; req uuid; result jsonb; j workflow_inbound_queue; expected boolean;
begin
 insert into auth.users(id,email) values(u,'human-agent@test.invalid'),(outsider,'outside@test.invalid');
 insert into businesses(id,name,slug) values(b,'Human Agent test','human-agent-test');
 insert into business_users(business_id,user_id,role) values(b,u,'owner');
 foreach ch in array array['instagram','whatsapp'] loop
  conn:=gen_random_uuid(); c:=gen_random_uuid();
  if ch='instagram' then
   insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values(conn,b,'human-agent-test','test','connected');
  else
   insert into whatsapp_connections(id,business_id,phone_number_id,waba_id,access_token_ciphertext,status) values(conn,b,'human-agent-test','test-waba','test','connected');
  end if;
  insert into conversations(id,business_id,channel,instagram_connection_id,instagram_participant_id,whatsapp_connection_id,whatsapp_participant_id)
   values(c,b,ch,case when ch='instagram' then conn end,case when ch='instagram' then 'person' end,case when ch='whatsapp' then conn end,case when ch='whatsapp' then 'person' end);
  foreach age in array array[23,24,48,167,168,169] loop
   update conversations set last_inbound_at=now()-make_interval(hours=>age) where id=c;
   expected:=age<24 or (ch='instagram' and age<168); req:=gen_random_uuid();
   begin
    result:=enqueue_transport_operation(b,u,req,'staff',c,null,repeat('a',64),'{"body":"Manual support"}');
    if not expected then raise exception 'Expired enqueue accepted'; end if;
   exception when others then
    if expected or sqlerrm<>'transport_window_closed' then raise; end if;
   end;
   if not expected then continue; end if;
   select * into j from workflow_inbound_queue where id=(result->>'id')::bigint;
   if (enqueue_transport_operation(b,u,req,'staff',c,null,repeat('a',64),'{"body":"Manual support"}')->>'id')::bigint<>j.id then raise exception 'Duplicate operation'; end if;
   update workflow_inbound_queue set lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes' where id=j.id returning * into j;
   if not begin_workflow_send(j.id,j.lease_token) then raise exception 'Valid manual send rejected'; end if;
   -- A definite failure may retry the same operation, including after 24h on Instagram.
   insert into message_transport_parts(job_id,business_id,connection_id,channel,participant_id,part_index,part_count,body,status)
    values(j.id,b,conn,ch,'person',0,1,'Manual support','failed');
   update workflow_inbound_queue set status='uncertain',attempts=1 where id=j.id;
   perform retry_staff_transport(b,u,c,req,1);
   -- Expiration while queued is rechecked at send time, not just enqueue.
   update conversations set last_inbound_at=now()-interval '8 days' where id=c;
   update workflow_inbound_queue set lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes' where id=j.id returning * into j;
   if begin_workflow_send(j.id,j.lease_token) then raise exception 'Expired queued send accepted'; end if;
  end loop;
  update conversations set last_inbound_at=now() where id=c;
  begin
   perform enqueue_transport_operation(b,outsider,gen_random_uuid(),'staff',c,null,repeat('a',64),'{"body":"Not authorized"}');
   raise exception 'Outsider accepted';
  exception when others then if sqlerrm<>'transport_forbidden' then raise; end if; end;
 end loop;
 if has_function_privilege('authenticated','enqueue_transport_operation(uuid,uuid,uuid,text,uuid,integer,text,jsonb)','execute') then raise exception 'RPC exposed'; end if;
end $$;
rollback;
