begin;

create or replace function public.save_workflow_booking(
 p_job bigint,p_token uuid,p_conversation uuid,p_revision integer,
 p_service uuid,p_name text,p_contact text,p_start timestamptz,
 p_status text,p_notes text,p_request_key text
) returns public.bookings language plpgsql security definer set search_path=public as $$
declare job workflow_inbound_queue; c conversations; b bookings; current_revision integer; enabled boolean; checkpoint jsonb; selected_action jsonb; terms jsonb; service_row booking_services; settings_row business_calendar_settings;
begin
 select * into job from workflow_inbound_queue where id=p_job and lease_token=p_token
  and status='processing' and leased_until>now() for update;
 if not found then raise exception 'lease_lost'; end if;
 select * into c from conversations where id=p_conversation and business_id=job.business_id
  and workflow_conversation_matches(conversations,job) for update;
 if not found then raise exception 'invalid_conversation'; end if;
 select coalesce(c.auto_reply,auto_reply,false) into enabled from businesses where id=job.business_id for update;
 if c.status<>'active' or not enabled then raise exception 'ownership_lost'; end if;
 select revision,collected into current_revision,checkpoint from conversation_states where conversation_id=p_conversation and business_id=job.business_id for update;
 if current_revision is distinct from p_revision then raise exception 'stale_state'; end if;
 if p_request_key is null or p_request_key not like 'ig:'||p_conversation::text||':%' or length(p_request_key)>200
  or p_status not in ('pending','confirmed') then raise exception 'invalid_booking_effect'; end if;
 select booked.* into b from workflow_booking_effects e join bookings booked on booked.id=e.booking_id
  where e.job_id=p_job and e.business_id=job.business_id and e.conversation_id=p_conversation and e.request_key=p_request_key;
 if found then return b; end if;
 -- The process checkpoint is the authority for reviewed inputs, never the model or caller.
 if checkpoint->>'schemaVersion'='4' then
  select item.value->'action' into selected_action
   from jsonb_each(checkpoint->'instances') item
   where item.value->'action'->>'tool'='booking.create'
    and p_request_key='ig:'||p_conversation::text||':'||(item.value->'action'->>'id');
  if selected_action is null or selected_action->>'status'<>'running'
   or selected_action->>'toolVersion'<>'1'
   or coalesce((selected_action->'approval'->>'expiresAt')::numeric,0)<=extract(epoch from clock_timestamp())*1000
   or checkpoint->>'mode'<>'live'
   or checkpoint->>'businessId' is distinct from job.business_id::text
   or checkpoint->>'conversationId' is distinct from p_conversation::text
   then raise exception 'invalid_booking_effect'; end if;
  terms:=selected_action->'input';
  select * into service_row from booking_services where business_id=job.business_id and id=p_service for share;
  if not found or not service_row.is_active or not service_row.booking_enabled then raise exception 'service_unavailable'; end if;
  select * into settings_row from business_calendar_settings where business_id=job.business_id for share;
  if not found or not settings_row.agent_booking_enabled then raise exception 'agent_booking_disabled'; end if;
  if jsonb_build_object('serviceId',service_row.id,'serviceName',service_row.name,
    'durationMinutes',service_row.duration_minutes,'bufferMinutes',service_row.buffer_minutes,
    'timezone',settings_row.timezone,'confirmationMode',settings_row.confirmation_mode)
   is distinct from jsonb_build_object('serviceId',terms->'serviceId','serviceName',terms->'serviceName',
    'durationMinutes',terms->'durationMinutes','bufferMinutes',terms->'bufferMinutes',
    'timezone',terms->'timezone','confirmationMode',terms->'confirmationMode')
   then raise exception 'booking_terms_changed'; end if;
  if p_name is distinct from terms->>'name' or p_contact is distinct from terms->>'contact'
   or p_notes is distinct from ''
   or p_start is distinct from (((terms->>'date')||' '||(terms->>'time'))::timestamp at time zone settings_row.timezone)
   or p_status is distinct from (case when settings_row.confirmation_mode='automatic' then 'confirmed' else 'pending' end)
   then raise exception 'invalid_booking_effect'; end if;
 end if;
 b:=save_calendar_booking(job.business_id,null,0,p_service,p_name,p_contact,p_start,p_status,p_notes,p_request_key);
 insert into workflow_booking_effects(job_id,business_id,conversation_id,request_key,booking_id)
  values(p_job,job.business_id,p_conversation,p_request_key,b.id)
  on conflict(business_id,request_key) do nothing;
 return b;
end $$;

commit;
