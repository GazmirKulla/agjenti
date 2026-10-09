-- Run only in an isolated test database after calendar_bookings migration.
begin;
do $$
declare bid uuid:=gen_random_uuid(); other_bid uuid:=gen_random_uuid(); sid uuid; b bookings; same bookings; start_at timestamptz:=date_trunc('day',now())+interval '2 days 12 hours';
begin
 insert into businesses(id,name,slug) values(bid,'Calendar test','calendar-test'),(other_bid,'Other test','other-calendar-test');
 insert into booking_services(business_id,name,duration_minutes,buffer_minutes) values(bid,'Haircut',30,15) returning id into sid;
 insert into business_calendar_settings(business_id,timezone,hours) values(bid,'UTC',(select jsonb_agg(jsonb_build_object('day',n,'start','09:00','end','17:00')) from generate_series(0,6)n));
 b:=save_calendar_booking(bid,null,0,sid,'Client One','',start_at,'pending','','request-1');
 if b.ends_at<>start_at+interval '30 minutes' or b.blocked_until<>start_at+interval '45 minutes' then raise exception 'duration/buffer mismatch';end if;
 begin
  perform save_calendar_booking(bid,null,0,sid,'Client Two','',start_at+interval '35 minutes','confirmed','');
  raise exception 'overlap incorrectly allowed';
 exception when exclusion_violation then null;end;
 same:=save_calendar_booking(bid,null,0,sid,'Client One','',start_at,'confirmed','','request-1');
 if same.id<>b.id then raise exception 'idempotency mismatch';end if;
 begin
  perform save_calendar_booking(bid,b.id,99,sid,'Client One','',start_at,'confirmed','');
  raise exception 'stale revision accepted';
 exception when raise_exception then if sqlerrm<>'stale_booking' then raise;end if;end;
 begin
  perform save_calendar_booking(other_bid,null,0,sid,'Client Other','',start_at,'confirmed','');
  raise exception 'foreign service accepted';
 exception when raise_exception then if sqlerrm<>'service_unavailable' then raise;end if;end;
 begin
  perform save_calendar_booking(bid,null,0,sid,'Client Early','',date_trunc('day',start_at)+interval '8 hours','confirmed','');
  raise exception 'outside hours accepted';
 exception when raise_exception then if sqlerrm<>'outside_hours' then raise;end if;end;
 update business_calendar_settings set closed_dates=jsonb_build_array((start_at at time zone 'UTC')::date::text) where business_id=bid;
 begin
  perform save_calendar_booking(bid,null,0,sid,'Client Closed','',start_at+interval '2 hours','confirmed','');
  raise exception 'closed day accepted';
 exception when raise_exception then if sqlerrm<>'outside_hours' then raise;end if;end;
 perform save_calendar_booking(bid,b.id,b.revision,sid,'Client One','',start_at,'cancelled','');
 update business_calendar_settings set closed_dates='[]' where business_id=bid;
 same:=save_calendar_booking(bid,null,0,sid,'Client Three','',start_at,'confirmed','');
 if same.id=b.id then raise exception 'cancelled booking reused';end if;
 begin
  perform save_calendar_booking(bid,null,0,sid,'Agent Client','',start_at+interval '2 hours','confirmed','','ig:test:disabled');
  raise exception 'disabled agent booking accepted';
 exception when raise_exception then if sqlerrm<>'agent_booking_disabled' then raise;end if;end;
 update business_calendar_settings set agent_booking_enabled=true, confirmation_mode='manual' where business_id=bid;
 same:=save_calendar_booking(bid,null,0,sid,'Agent Client','',start_at+interval '2 hours','confirmed','','ig:test:manual');
 if same.status<>'pending' then raise exception 'manual approval bypassed';end if;
 update business_calendar_settings set confirmation_mode='automatic' where business_id=bid;
 same:=save_calendar_booking(bid,null,0,sid,'Agent Client','',start_at+interval '3 hours','confirmed','','ig:test:automatic');
 if same.status<>'confirmed' then raise exception 'automatic confirmation mismatch';end if;
 if has_table_privilege('authenticated','google_calendar_connections','select') then raise exception 'credentials readable';end if;
 if has_function_privilege('authenticated','save_calendar_booking(uuid,uuid,integer,uuid,text,text,timestamptz,text,text,text)','execute') then raise exception 'untrusted booking writes allowed';end if;
end $$;
rollback;
