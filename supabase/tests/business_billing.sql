-- Isolated allowance checks. The test is rolled back so it can run with the full suite.
begin;
do $$
declare
  bid uuid := gen_random_uuid();
  conn uuid := gen_random_uuid();
  cid uuid := gen_random_uuid();
  first_job workflow_inbound_queue;
  last_job workflow_inbound_queue;
  first_lease uuid := gen_random_uuid();
  last_lease uuid := gen_random_uuid();
  current_period timestamptz;
begin
  insert into businesses(id,name,slug,auto_reply) values(bid,'Billing test','billing-' || left(bid::text,8),true);
  insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status)
    values(conn,bid,'billing-test','test','connected');
  insert into conversations(id,business_id,channel,instagram_participant_id,instagram_connection_id,auto_reply)
    values(cid,bid,'instagram','customer',conn,true);
  insert into conversation_states(conversation_id,business_id) values(cid,bid);

  insert into workflow_inbound_queue(business_id,channel,connection_id,participant_id,external_id,payload,status,lease_token,leased_until,conversation_id,reply)
    values(bid,'instagram',conn,'customer','billing-first','{}','prepared',first_lease,now()+interval '5 minutes',cid,'Përgjigjja e parë');
  select * into first_job from workflow_inbound_queue where connection_id=conn and external_id='billing-first';
  if not begin_workflow_send(first_job.id,first_lease) then raise exception 'Free allowance did not permit first send'; end if;
  perform finish_workflow_send(first_job.id,first_lease,true,'billing-out-1',null);
  select period_start into current_period from business_usage where business_id=bid;
  if (select used from business_usage where business_id=bid and period_start=current_period)<>1 then raise exception 'Confirmed delivery was not charged once'; end if;
  if not exists(select 1 from message_allowance_reservations where job_id=first_job.id and status='sent') then raise exception 'Confirmed delivery reservation not settled'; end if;

  -- The final monthly slot can be reserved, but a concurrent next job is refused.
  update business_usage set used=999 where business_id=bid and period_start=current_period;
  insert into workflow_inbound_queue(business_id,channel,connection_id,participant_id,external_id,payload,status,lease_token,leased_until,conversation_id,reply)
    values(bid,'instagram',conn,'customer','billing-last','{}','prepared',last_lease,now()+interval '5 minutes',cid,'Përgjigjja e fundit');
  select * into last_job from workflow_inbound_queue where connection_id=conn and external_id='billing-last';
  if not begin_workflow_send(last_job.id,last_lease) then raise exception 'Final allowance slot was denied'; end if;
  if (select available::bigint from jsonb_to_record(business_allowance(bid)) as allowance(available text))<>0 then raise exception 'Reservation did not hold final allowance slot'; end if;

  insert into workflow_inbound_queue(business_id,channel,connection_id,participant_id,external_id,payload,status,lease_token,leased_until,conversation_id,reply)
    values(bid,'instagram',conn,'customer','billing-over','{}','prepared',gen_random_uuid(),now()+interval '5 minutes',cid,'Mos dërgo');
  if begin_workflow_send((select id from workflow_inbound_queue where connection_id=conn and external_id='billing-over'),(select lease_token from workflow_inbound_queue where connection_id=conn and external_id='billing-over')) then raise exception 'Allowance overflow was sent'; end if;
  if not exists(select 1 from workflow_inbound_queue where connection_id=conn and external_id='billing-over' and status='ignored' and error='Monthly message allowance exhausted') then raise exception 'Allowance overflow was not marked'; end if;
end $$;
rollback;
