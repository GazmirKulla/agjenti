-- No Meta/OpenAI calls. Rolled-back fixtures exercise the actual queue functions.
begin;
do $$
declare b uuid:=gen_random_uuid(); conn uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 j workflow_inbound_queue; retry workflow_inbound_queue; saved jsonb;
begin
 if workflow_inbound_batch_wait_ms()<>0 then raise exception 'Empty queue must not spin'; end if;
 insert into businesses(id,name,slug,auto_reply) values(b,'Batch test','batch-test',true);
 insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values(conn,b,'batch-account','test','connected');
 insert into conversations(id,business_id,instagram_participant_id,instagram_connection_id,channel) values(c,b,'person',conn,'instagram');
 insert into conversation_states(conversation_id,business_id) values(c,b);
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel)
 select b,conn,'person','message-'||ordinal,jsonb_build_object('text',body),'instagram'
 from unnest(array['Ckemi','Si jeni','Dua te porosis montesori','E keni ne gjendje?']) with ordinality as items(body,ordinal);
 if exists(select 1 from claim_workflow_inbound_batch(array[b])) then raise exception 'Claim before quiet interval'; end if;
 if workflow_inbound_batch_wait_ms() not between 1 and 3000 then raise exception 'Missing wakeup'; end if;
 update workflow_inbound_queue set created_at=clock_timestamp()-interval '4 seconds' where business_id=b;
 select * into j from claim_workflow_inbound_batch(array[b]);
 if j.external_id is distinct from 'message-1' or jsonb_array_length(j.batch_payloads)<>4 then raise exception 'Burst not grouped'; end if;
 if j.batch_payloads->2->>'text' is distinct from 'Dua te porosis montesori' then raise exception 'Order not retained'; end if;
 if (select count(*) from workflow_inbound_queue where batch_parent_id=j.id and status='batched')<>3 then raise exception 'Membership not persisted'; end if;
 -- Redelivery cannot reset membership or create another work item.
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel)
 values(b,conn,'person','message-2','{}','instagram') on conflict(connection_id,external_id) do nothing;
 if (select count(*) from workflow_inbound_queue where business_id=b)<>4 then raise exception 'Duplicate batch child'; end if;
 if exists(select 1 from claim_workflow_inbound_batch(array[b])) then raise exception 'Batch processed concurrently'; end if;
 saved:=j.batch_payloads;
 -- Later arrivals cannot enter the frozen batch, even after a crash/retry.
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel)
 values(b,conn,'person','later','{"text":"later"}','instagram');
 update workflow_inbound_queue set leased_until=clock_timestamp()-interval '1 second' where id=j.id;
 if exists(select 1 from claim_workflow_inbound(array[b])) then raise exception 'Old worker consumed frozen batch'; end if;
 select * into retry from claim_workflow_inbound_batch(array[b]);
 if retry.id is distinct from j.id or retry.batch_payloads is distinct from saved or retry.lease_token=j.lease_token then raise exception 'Unstable retry'; end if;
 perform prepare_workflow_reply(retry.id,retry.lease_token,c,0,'{"fields":{"product":"Montessori"}}',null,'One response',null,false);
 -- Recovery from prepared sends the same answer without regenerating a turn.
 update workflow_inbound_queue set leased_until=clock_timestamp()-interval '1 second' where id=j.id;
 select * into retry from claim_workflow_inbound_batch(array[b]);
 if retry.status<>'prepared' or retry.reply<>'One response' then raise exception 'Prepared reply lost'; end if;
 if not begin_workflow_send(retry.id,retry.lease_token) then raise exception 'Batch send denied'; end if;
 perform finish_workflow_send(retry.id,retry.lease_token,true,'out-batch',null);
 if (select count(*) from messages where conversation_id=c and direction='outbound')<>1 then raise exception 'Multiple batch replies'; end if;
 if (select revision from conversation_states where conversation_id=c)<>1 then raise exception 'Multiple state advancements'; end if;
 update workflow_inbound_queue set created_at=clock_timestamp()-interval '4 seconds' where external_id='later';
 select * into j from claim_workflow_inbound_batch(array[b]);
 if j.external_id is distinct from 'later' or jsonb_array_length(j.batch_payloads)<>1 then raise exception 'Later message lost'; end if;
 -- A busy stream has a maximum wait and a bounded batch size.
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel,created_at)
 select b,conn,'busy','busy-'||n,'{}','instagram',case when n=1 then clock_timestamp()-interval '11 seconds' else clock_timestamp() end from generate_series(1,21)n;
 select * into j from claim_workflow_inbound_batch(array[b]);
 if j.participant_id is distinct from 'busy' or jsonb_array_length(j.batch_payloads)<>20 then raise exception 'Wait/size bound failed'; end if;
 if (select count(*) from workflow_inbound_queue where participant_id='busy' and status='queued')<>1 then raise exception 'Overflow message lost'; end if;
 if workflow_inbound_batch_wait_ms()<>0 then raise exception 'Worker must not spin behind another active batch'; end if;
 if has_function_privilege('authenticated','claim_workflow_inbound_batch(uuid[])','execute')
  or has_function_privilege('anon','workflow_inbound_batch_wait_ms()','execute') then raise exception 'Batch RPC exposed'; end if;
end $$;
rollback;
