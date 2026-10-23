-- Isolated database only. No provider calls; all fixtures roll back.
begin;
do $$
declare bid uuid := gen_random_uuid(); conn uuid; cid uuid; ch text; j workflow_inbound_queue;
 snapshot jsonb := '{"staffHandoff":true,"product_id":"saved-product","fields":{"size":"L"},"step_key":"size","context":{"profile":{}}}';
begin
 insert into businesses(id,name,slug,auto_reply) values(bid,'Handoff test','staff-handoff-test',true);
 foreach ch in array array['instagram','whatsapp'] loop
  conn := gen_random_uuid(); cid := gen_random_uuid();
  if ch='instagram' then
   insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values(conn,bid,'handoff-test','test','connected');
  else
   insert into whatsapp_connections(id,business_id,phone_number_id,waba_id,access_token_ciphertext,status) values(conn,bid,'handoff-test','handoff-waba','test','connected');
  end if;
  insert into conversations(id,business_id,channel,instagram_participant_id,instagram_connection_id,whatsapp_participant_id,whatsapp_connection_id)
   values(cid,bid,ch,case when ch='instagram' then 'person' end,case when ch='instagram' then conn end,case when ch='whatsapp' then 'person' end,case when ch='whatsapp' then conn end);
  insert into conversation_states(conversation_id,business_id) values(cid,bid);
  insert into workflow_inbound_queue(business_id,channel,connection_id,participant_id,external_id,payload) values(bid,ch,conn,'person','handoff','{}');
  select * into j from claim_workflow_inbound(array[bid]);
  perform prepare_workflow_reply(j.id,j.lease_token,cid,0,snapshot,null,'Biseda iu kalua stafit',null,true);
  if (select status from conversations where id=cid)<>'active' then raise exception 'Pause occurred before send claim'; end if;
  if not (select handoff_requested from workflow_inbound_queue where id=j.id) then raise exception 'Missing handoff intent'; end if;
  if begin_workflow_send(j.id,gen_random_uuid()) then raise exception 'Foreign lease sent handoff'; end if;
  -- Recovery of prepared output must retain ownership intent without re-running the engine.
  update workflow_inbound_queue set leased_until=now()-interval '1 second' where id=j.id;
  select * into j from claim_workflow_inbound(array[bid]);
  if j.status<>'prepared' or not j.handoff_requested then raise exception 'Recovery lost handoff'; end if;
  if not begin_workflow_send(j.id,j.lease_token) then raise exception 'Handoff acknowledgement was blocked'; end if;
  if not exists(select 1 from conversations where id=cid and status='paused' and auto_reply=false) then raise exception 'AI still active during acknowledgement'; end if;
  if begin_workflow_send(j.id,j.lease_token) then raise exception 'Duplicate acknowledgement'; end if;
  if (select collected from conversation_states where conversation_id=cid)<>snapshot then raise exception 'Handoff lost draft'; end if;
  perform finish_workflow_send(j.id,j.lease_token,false,null,'Provider timeout');
  if (select status from workflow_inbound_queue where id=j.id)<>'uncertain' then raise exception 'Failure reported as success'; end if;
  if exists(select 1 from messages where conversation_id=cid and direction='outbound') then raise exception 'Failed acknowledgement stored as sent'; end if;
  if (select status from conversations where id=cid)<>'paused' then raise exception 'Delivery failure reactivated AI'; end if;
  -- A status toggle alone must not bypass an uncertain preceding send.
  if exists(select 1 from claim_workflow_inbound(array[bid])) then raise exception 'Uncertain send replayed'; end if;
  perform finish_workflow_send(j.id,j.lease_token,true,'late-handoff-'||ch,null);
  -- After reconciliation, staff explicitly reactivates; a new handoff
  -- prepared before takeover is still discarded.
  update conversations set status='active',auto_reply=true where id=cid;
  insert into workflow_inbound_queue(business_id,channel,connection_id,participant_id,external_id,payload) values(bid,ch,conn,'person','second-handoff','{}');
  select * into j from claim_workflow_inbound(array[bid]);
  begin
   perform prepare_workflow_reply(j.id,j.lease_token,cid,0,snapshot,null,'Stale',null,true);
   raise exception 'Stale handoff accepted' using errcode='XX001';
  exception when raise_exception then if sqlerrm<>'stale_state' then raise; end if; end;
  perform prepare_workflow_reply(j.id,j.lease_token,cid,1,snapshot,null,'Discard this acknowledgement',null,true);
  update conversations set status='paused',auto_reply=false where id=cid;
  if begin_workflow_send(j.id,j.lease_token) then raise exception 'Manual ownership overridden'; end if;
  if (select status from workflow_inbound_queue where id=j.id)<>'ignored' then raise exception 'Prepared output not discarded'; end if;
  -- Normal advisory output never pauses the conversation.
  update conversations set status='active',auto_reply=true where id=cid;
  insert into workflow_inbound_queue(business_id,channel,connection_id,participant_id,external_id,payload) values(bid,ch,conn,'person','advice','{}');
  select * into j from claim_workflow_inbound(array[bid]);
  perform prepare_workflow_reply(j.id,j.lease_token,cid,2,snapshot-'staffHandoff',null,'Kontakt i verifikuar',null,false);
  if not begin_workflow_send(j.id,j.lease_token) then raise exception 'Advice blocked'; end if;
  if (select status from conversations where id=cid)<>'active' then raise exception 'Advice paused AI'; end if;
  perform finish_workflow_send(j.id,j.lease_token,true,'sent-advice-'||ch,null);
 end loop;
end $$;
rollback;
