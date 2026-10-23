-- Transport contract: every NEW message is a separate ordered turn.
-- Historical frozen batches still drain unchanged. No Meta/OpenAI calls.
begin;
do $$
declare b uuid:=gen_random_uuid(); conn uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 j workflow_inbound_queue; retry workflow_inbound_queue; saved jsonb; i integer;
begin
 insert into businesses(id,name,slug,auto_reply) values(b,'FIFO test','fifo-test',true);
 insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values(conn,b,'fifo-account','test','connected');
 insert into conversations(id,business_id,instagram_participant_id,instagram_connection_id,channel,auto_reply,status) values(c,b,'person',conn,'instagram',true,'active');
 insert into conversation_states(conversation_id,business_id) values(c,b);
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel)
 select b,conn,'person','message-'||n,jsonb_build_object('text','message '||n),'instagram' from generate_series(1,3)n;
 -- Duplicate webhook delivery retains identity, original order and content.
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel)
 values(b,conn,'person','message-2','{}','instagram') on conflict(connection_id,external_id) do nothing;
 if (select count(*) from workflow_inbound_queue where business_id=b)<>3 then raise exception 'Duplicate inbound'; end if;
 for i in 1..3 loop
  select * into j from claim_workflow_inbound_batch(array[b]);
  if j.external_id is distinct from 'message-'||i or j.batch_payloads is not null then raise exception 'New messages merged, delayed or reordered'; end if;
  if exists(select 1 from claim_workflow_inbound(array[b])) then raise exception 'Concurrent same-stream turn'; end if;
  perform bind_workflow_inbound(j.id,j.lease_token,c);
  select collected into saved from conversation_states where conversation_id=c;
  saved:=coalesce(saved,'{}')||jsonb_build_object('fields',coalesce(saved->'fields','{}')||jsonb_build_object('field_'||i,'value_'||i));
  perform prepare_workflow_reply(j.id,j.lease_token,c,i-1,saved,null,'reply '||i,null,false);
  if not begin_workflow_send(j.id,j.lease_token) then raise exception 'Send denied'; end if;
  perform finish_workflow_send(j.id,j.lease_token,true,'out-'||i,null);
 end loop;
 if (select revision from conversation_states where conversation_id=c)<>3 then raise exception 'State advances lost'; end if;
 if (select collected->'fields'->>'field_1' from conversation_states where conversation_id=c)<>'value_1' then raise exception 'Prior facts lost'; end if;
 if (select count(*) from messages where conversation_id=c and direction='outbound')<>3 then raise exception 'Reply count wrong'; end if;
 -- Pre-migration frozen batch: claimant never edits payload or membership.
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel,conversation_id,batch_payloads)
 values(b,conn,'person','legacy-1','{"text":"legacy 1"}','instagram',c,'[{"text":"legacy 1"},{"text":"legacy 2"}]') returning * into j;
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel,status,batch_parent_id)
 values(b,conn,'person','legacy-2','{"text":"legacy 2"}','instagram','batched',j.id);
 saved:=j.batch_payloads;
 select * into j from claim_workflow_inbound_batch(array[b]);
 update workflow_inbound_queue set leased_until=clock_timestamp()-interval '1 second' where id=j.id;
 select * into retry from claim_workflow_inbound(array[b]);
 if retry.id is distinct from j.id or retry.batch_payloads is distinct from saved or retry.lease_token=j.lease_token then raise exception 'Frozen batch retry changed'; end if;
 perform prepare_workflow_reply(retry.id,retry.lease_token,c,3,'{"fields":{"legacy":"saved"}}',null,'Legacy response',null,false);
 update workflow_inbound_queue set leased_until=clock_timestamp()-interval '1 second' where id=j.id;
 select * into retry from claim_workflow_inbound_batch(array[b]);
 if retry.status<>'prepared' or retry.reply<>'Legacy response' then raise exception 'Prepared recovery lost'; end if;
 if not begin_workflow_send(retry.id,retry.lease_token) then raise exception 'Legacy send denied'; end if;
 perform finish_workflow_send(retry.id,retry.lease_token,true,'legacy-out',null);
 if exists(select 1 from claim_workflow_inbound_batch(array[b])) then raise exception 'Legacy child replay'; end if;
 if workflow_inbound_batch_wait_ms()<>0 then raise exception 'Empty worker spins'; end if;
 -- An unresolved stream must not starve another conversation behind a burst.
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel,status)
 values(b,conn,'blocked','blocked-head','{}','instagram','uncertain');
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel)
 select b,conn,'blocked','blocked-'||n,'{}','instagram' from generate_series(1,101)n;
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel)
 values(b,conn,'independent','independent','{}','instagram');
 select * into j from claim_workflow_inbound_batch(array[b]);
 if j.participant_id is distinct from 'independent' then raise exception 'Blocked stream starves independent conversation'; end if;
 if has_function_privilege('authenticated','claim_workflow_inbound_batch(uuid[])','execute')
  or has_function_privilege('anon','workflow_inbound_batch_wait_ms()','execute') then raise exception 'Queue RPC exposed'; end if;
end $$;
rollback;
