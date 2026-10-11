-- Isolated database only; provider responses are synthetic and rolled back.
begin;
do $$
declare bid uuid:=gen_random_uuid(); conn uuid; cid uuid; ch text; j workflow_inbound_queue; revision_before integer;
begin
 insert into businesses(id,name,slug,auto_reply) values(bid,'Receipt test','delivery-receipt-test',true);
 foreach ch in array array['instagram','whatsapp'] loop
  conn:=gen_random_uuid(); cid:=gen_random_uuid();
  if ch='instagram' then
   insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values(conn,bid,'receipt-test','test','connected');
  else
   insert into whatsapp_connections(id,business_id,phone_number_id,waba_id,access_token_ciphertext,status) values(conn,bid,'receipt-test','receipt-waba','test','connected');
  end if;
  insert into conversations(id,business_id,channel,instagram_participant_id,instagram_connection_id,whatsapp_participant_id,whatsapp_connection_id)
   values(cid,bid,ch,case when ch='instagram' then 'person' end,case when ch='instagram' then conn end,case when ch='whatsapp' then 'person' end,case when ch='whatsapp' then conn end);
  insert into conversation_states(conversation_id,business_id) values(cid,bid);
  insert into workflow_inbound_queue(business_id,channel,connection_id,participant_id,external_id,payload) values(bid,ch,conn,'person','receipt','{}');
  select * into j from claim_workflow_inbound(array[bid]);
  perform prepare_workflow_reply(j.id,j.lease_token,cid,0,'{"step_key":"city","fields":{"size":"L"}}',null,'Qyteti?',null,false);
  if exists(select 1 from messages where conversation_id=cid and direction='outbound') then raise exception 'Prepare is not delivery'; end if;
  -- Crash before send: recover identical output without another state mutation.
  update workflow_inbound_queue set leased_until=now()-interval '1 second' where id=j.id;
  select * into j from claim_workflow_inbound(array[bid]);
  select revision into revision_before from conversation_states where conversation_id=cid;
  if j.status<>'prepared' or j.reply<>'Qyteti?' then raise exception 'Prepared reply lost'; end if;
  if not begin_workflow_send(j.id,j.lease_token) then raise exception 'Send unavailable'; end if;
  if begin_workflow_send(j.id,j.lease_token) then raise exception 'Duplicate worker allowed'; end if;
  begin
   perform finish_workflow_send(j.id,j.lease_token,true,null,null);
   raise exception 'Missing receipt accepted' using errcode='XX001';
  exception when raise_exception then if sqlerrm<>'receipt_required' then raise; end if; end;
  perform finish_workflow_send(j.id,j.lease_token,false,null,'timeout');
  perform finish_workflow_send(j.id,j.lease_token,false,null,'timeout');
  if (select count(*) from agent_turns where conversation_id=cid)<>1 then raise exception 'Duplicate failure receipt'; end if;
  if (select status from conversations where id=cid)<>'paused' then raise exception 'Uncertain delivery is active'; end if;
  if (select revision from conversation_states where conversation_id=cid)<>revision_before then raise exception 'Receipt changed execution'; end if;
  -- A late provider receipt reconciles without overwriting staff context or retry.
  update conversations set last_message_preview='Staff reply',openai_previous_response_id=null where id=cid;
  begin
   perform finish_workflow_send(j.id,gen_random_uuid(),true,'wrong',null);
   raise exception 'Wrong lease accepted' using errcode='XX001';
  exception when raise_exception then if sqlerrm<>'lease_lost' then raise; end if; end;
  perform finish_workflow_send(j.id,j.lease_token,true,'receipt-'||ch,null);
  perform finish_workflow_send(j.id,j.lease_token,true,'receipt-'||ch,null);
  if (select count(*) from messages where conversation_id=cid and direction='outbound')<>1 then raise exception 'Duplicate outbound'; end if;
  if (select count(*) from agent_turns where conversation_id=cid and status='ok')<>1 then raise exception 'Duplicate success receipt'; end if;
  if not exists(select 1 from workflow_inbound_queue where id=j.id and status='sent' and provider_message_id='receipt-'||ch and send_started_at is not null) then raise exception 'Receipt not retained'; end if;
  if not exists(select 1 from conversations where id=cid and status='paused' and last_message_preview='Staff reply') then raise exception 'Late receipt overwrote staff'; end if;
  begin
   perform finish_workflow_send(j.id,j.lease_token,true,'different',null);
   raise exception 'Conflicting receipt accepted' using errcode='XX001';
  exception when raise_exception then if sqlerrm<>'receipt_conflict' then raise; end if; end;
 end loop;
end $$;
rollback;
