-- Isolated routing fixture only; run with test-sql.py, never on a deployed database.
begin;
insert into businesses(id) values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into business_users(business_id,user_id) values
('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),
('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'),
('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003');
truncate realtime.messages;
update businesses set body='private business details' where id='10000000-0000-4000-8000-000000000001';
do $$ begin
 if (select count(*) from realtime.messages)<>2 then raise exception 'wrong recipients'; end if;
 if exists(select 1 from realtime.messages where payload<>'{"resource":"business"}'::jsonb) then raise exception 'data leaked'; end if;
 if exists(select 1 from capability_events) then raise exception 'trigger failed'; end if;
end $$;
truncate realtime.messages;
insert into assistant_conversations(id,business_id,owner_user_id,body) values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','secret');
do $$ begin
 if (select count(*) from realtime.messages)<>1 or exists(select 1 from realtime.messages where topic<>'updates:20000000-0000-4000-8000-000000000001') then raise exception 'private assistant leaked'; end if;
end $$;
truncate realtime.messages;
update assistant_conversations set updated_at=now();
do $$ begin if exists(select 1 from realtime.messages) then raise exception 'timestamp feedback loop'; end if; end $$;
delete from business_users where user_id='20000000-0000-4000-8000-000000000002';
truncate realtime.messages;
update businesses set body='changed' where id='10000000-0000-4000-8000-000000000001';
do $$ begin
 if (select count(*) from realtime.messages)<>1 then raise exception 'revoked member notified'; end if;
end $$;
insert into realtime.messages values('updates:20000000-0000-4000-8000-000000000003','broadcast','{}');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select set_config('realtime.topic','updates:20000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
 if (select count(*) from realtime.messages)<>1 then raise exception 'RLS isolation failed'; end if;
 begin
  insert into realtime.messages values('updates:20000000-0000-4000-8000-000000000001','broadcast','{}');
  raise exception 'client can forge broadcast';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
savepoint atomicity;
update businesses set body='rolled back' where id='10000000-0000-4000-8000-000000000001';
rollback to atomicity;
do $$ begin if (select count(*) from realtime.messages)<>2 then raise exception 'event escaped rollback'; end if; end $$;
-- A broadcast outage must not roll back the business write, and must be recorded.
create or replace function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language plpgsql as $$ begin raise exception 'offline' using errcode='RT001'; end $$;
update businesses set body='saved despite realtime outage' where id='10000000-0000-4000-8000-000000000001';
do $$ begin
 if not exists(select 1 from businesses where body='saved despite realtime outage') then raise exception 'business write lost'; end if;
 if not exists(select 1 from capability_events where capability='system.realtime' and point='failed' and reason='broadcast:RT001') then raise exception 'failure not tracked'; end if;
end $$;
rollback;
