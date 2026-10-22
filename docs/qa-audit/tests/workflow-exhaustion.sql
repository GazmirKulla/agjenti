-- Audit-only regression. Run ONLY on a fresh disposable local test database
-- containing this repository's migrations, never a connected/shared database.
-- No provider calls; all fixture changes roll back. Intentionally fails until fixed.
begin;
do $$
declare b uuid:=gen_random_uuid(); conn uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 j public.workflow_inbound_queue; claim public.workflow_inbound_queue;
begin
 insert into public.businesses(id,name,slug,auto_reply) values(b,'Audit retry exhaustion','audit-retry-'||b::text,true);
 insert into public.instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status)
 values(conn,b,'audit-account-'||b::text,'audit-not-a-token','connected');
 insert into public.conversations(id,business_id,instagram_participant_id,instagram_connection_id,channel,status,auto_reply)
 values(c,b,'audit-person',conn,'instagram','active',true);
 insert into public.conversation_states(conversation_id,business_id) values(c,b);
 -- Same durable job shape that enqueueWorkflowMessage produces. The handler has
 -- already persisted inbound, but processing failed before prepare_workflow_reply.
 insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel,status,attempts,leased_until,created_at)
 values(b,conn,'audit-person','audit-failed-'||b::text,'{"text":"Change my address"}',
 'instagram','processing',3,now()-interval '1 second',now()-interval '5 seconds') returning * into j;
 insert into public.messages(business_id,conversation_id,instagram_connection_id,direction,source,body,external_message_id,delivery_status)
 values(b,c,conn,'inbound','customer','Change my address',j.external_id,'delivered');
 if j.conversation_id is not null then raise exception 'Fixture must reproduce pre-prepare unbound job'; end if;
 select * into claim from public.claim_workflow_inbound_batch(array[b]);
 if (select status from public.workflow_inbound_queue where id=j.id) <> 'failed' then raise exception 'Fixture did not reach retry exhaustion'; end if;
 if exists(select 1 from public.conversations where id=c and status='active' and auto_reply) then
  raise exception 'FAIL: exhausted processing dropped a persisted customer message but left its original conversation active';
 end if;
end $$;
rollback;
