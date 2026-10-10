-- Isolated database only; every fixture and action is rolled back.
begin;
do $$
declare bid uuid:=gen_random_uuid(); other_bid uuid:=gen_random_uuid(); connection uuid:=gen_random_uuid(); conversation uuid:=gen_random_uuid();
 sid uuid; job workflow_inbound_queue; b bookings; replay bookings; start_at timestamptz:=date_trunc('day',now())+interval '2 days 12 hours';
 request_key text; snapshot jsonb:='{"schemaVersion":3,"step_key":"booking_request","context":{"profile":{}}}';
begin
 insert into businesses(id,name,slug,auto_reply) values(bid,'Message workflow test','message-runtime-test',true),(other_bid,'Other runtime test','other-message-runtime-test',true);
 insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext) values(connection,bid,'message-runtime-account','test');
 insert into conversations(id,business_id,instagram_participant_id,instagram_connection_id) values(conversation,bid,'runtime-person',connection);
 insert into conversation_states(conversation_id,business_id) values(conversation,bid);
 insert into booking_services(business_id,name,duration_minutes,booking_enabled) values(bid,'Service',30,true) returning id into sid;
 insert into business_calendar_settings(business_id,timezone,hours,agent_booking_enabled,confirmation_mode)
  values(bid,'UTC',(select jsonb_agg(jsonb_build_object('day',n,'start','09:00','end','17:00')) from generate_series(0,6)n),true,'automatic');
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload) values(bid,connection,'runtime-person','confirm-1','{}');
 select * into job from claim_workflow_inbound(array[bid]);
 request_key:='ig:'||conversation::text||':stable-task';
 begin
  perform save_workflow_booking(job.id,gen_random_uuid(),conversation,0,sid,'Demo','',start_at,'confirmed','',request_key);
  raise exception 'Foreign lease accepted' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'lease_lost' then raise;end if;end;
 begin
  perform save_workflow_booking(job.id,job.lease_token,conversation,99,sid,'Demo','',start_at,'confirmed','',request_key);
  raise exception 'Stale state accepted' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'stale_state' then raise;end if;end;
 begin
  perform save_workflow_booking(job.id,job.lease_token,conversation,0,sid,'Demo','',start_at,'confirmed','','ig:foreign:task');
  raise exception 'Foreign request key accepted' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'invalid_booking_effect' then raise;end if;end;
 b:=save_workflow_booking(job.id,job.lease_token,conversation,0,sid,'Demo','',start_at,'confirmed','',request_key);
 if not exists(select 1 from workflow_booking_effects where job_id=job.id and booking_id=b.id) then raise exception 'No atomic receipt';end if;
 -- Simulate process loss after booking save, before state/reply commit.
 update workflow_inbound_queue set leased_until=now()-interval '1 second' where id=job.id;
 select * into job from claim_workflow_inbound(array[bid]);
 replay:=save_workflow_booking(job.id,job.lease_token,conversation,0,sid,'Demo','',start_at,'confirmed','',request_key);
 if replay.id<>b.id or (select count(*) from bookings where business_id=bid)<>1 then raise exception 'Replay duplicated reservation';end if;
 update conversations set status='paused',auto_reply=false where id=conversation;
 begin
  perform save_workflow_booking(job.id,job.lease_token,conversation,0,sid,'Demo','',start_at,'confirmed','',request_key);
  raise exception 'Staff ownership bypassed on replay' using errcode='XX001';
 exception when raise_exception then if sqlerrm<>'ownership_lost' then raise;end if;end;
 perform prepare_workflow_reply(job.id,job.lease_token,conversation,0,snapshot,null,'Must not send',null,false);
 if (select revision from conversation_states where conversation_id=conversation)<>0 then raise exception 'Staff state overwritten';end if;
 if begin_workflow_send(job.id,job.lease_token) then raise exception 'Paused reply sent';end if;
 update conversations set status='active',auto_reply=true where id=conversation;
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload) values(bid,connection,'runtime-person','message-2','{}');
 select * into job from claim_workflow_inbound(array[bid]);
 perform prepare_workflow_reply(job.id,job.lease_token,conversation,0,snapshot,null,'Prepared before takeover',null,false);
 update conversations set status='paused',auto_reply=false where id=conversation;
 if begin_workflow_send(job.id,job.lease_token) then raise exception 'Late takeover failed';end if;
 if (select status from workflow_inbound_queue where id=job.id)<>'ignored' then raise exception 'Prepared output retained after takeover';end if;
 if has_table_privilege('authenticated','workflow_booking_effects','select') or has_function_privilege('authenticated','save_workflow_booking(bigint,uuid,uuid,integer,uuid,text,text,timestamptz,text,text,text)','execute') then raise exception 'Effect boundary exposed';end if;
 delete from instagram_connections where id=connection;
 if exists(select 1 from workflow_booking_effects where business_id=bid) then raise exception 'Connection deletion left replay data';end if;
end $$;
rollback;
