-- Run in an isolated database after business_services migration.
begin;
do $$
declare bid uuid:=gen_random_uuid(); sid uuid; kid uuid; linked uuid; at_time timestamptz:=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')+interval '2 days 12 hours'; b bookings;
begin
 insert into businesses(id,name,slug) values(bid,'Service catalog test','service-catalog-test');
 insert into booking_services(business_id,name,description,duration_minutes,price_mode,price_amount,currency)
 values(bid,'Consulting','Online session',30,'fixed',50,'EUR') returning id,knowledge_entry_id into sid,kid;
 if (select booking_enabled from booking_services where id=sid) then raise exception 'booking enabled by default';end if;
 if not exists(select 1 from knowledge_entries where id=kid and business_id=bid and intent_key='service' and body like '%50.00 EUR%') then raise exception 'service facts unavailable to AI';end if;
 begin
  perform save_calendar_booking(bid,null,0,sid,'Customer','',at_time,'confirmed','');
  raise exception 'informational service booked';
 exception when raise_exception then if sqlerrm<>'service_unavailable' then raise;end if;end;
 insert into business_calendar_settings(business_id,timezone,hours) values(bid,'UTC',(select jsonb_agg(jsonb_build_object('day',n,'start','09:00','end','17:00')) from generate_series(0,6)n));
 update booking_services set booking_enabled=true,buffer_minutes=15,hours=jsonb_build_array(jsonb_build_object('day',extract(dow from at_time)::integer,'start','12:00','end','13:00')) where id=sid;
 b:=save_calendar_booking(bid,null,0,sid,'Customer','',at_time,'confirmed','');
 if b.service_id<>sid or b.blocked_until<>at_time+interval '45 minutes' then raise exception 'booking service association lost';end if;
 begin
  perform save_calendar_booking(bid,null,0,sid,'Customer','',at_time+interval '2 hours','confirmed','');
  raise exception 'outside service hours accepted';
 exception when raise_exception then if sqlerrm<>'outside_service_hours' then raise;end if;end;
 update booking_services set description='Updated session',is_active=false where id=sid returning knowledge_entry_id into linked;
 if linked<>kid or not exists(select 1 from knowledge_entries where id=kid and not is_active and body like 'Updated session%') then raise exception 'service knowledge out of sync';end if;
 -- Turning off bookings must still allow cancellation of the existing appointment.
 update booking_services set booking_enabled=false where id=sid;
 b:=save_calendar_booking(bid,b.id,b.revision,sid,'Customer','',at_time,'cancelled','');
 if b.status<>'cancelled' then raise exception 'disabled service cancellation blocked';end if;
 if has_table_privilege('authenticated','booking_services','update') then raise exception 'client bypass permitted';end if;
end $$;
rollback;
