-- Run only against an isolated test database after migrations; rolls back.
begin;
do $$
declare
  b uuid := gen_random_uuid();
  other_b uuid := gen_random_uuid();
  cu uuid := gen_random_uuid();
  echo_c uuid := gen_random_uuid();   -- answered from the Instagram app
  waiting_c uuid := gen_random_uuid(); -- customer wrote after the last reply
  failed_c uuid := gen_random_uuid();  -- the only reply failed to send
  import_c uuid := gen_random_uuid();  -- imported history ending with the business
  profile_c uuid := gen_random_uuid(); -- agent collected a validated email
  foreign_c uuid := gen_random_uuid();
  r record;
begin
  insert into businesses(id, name, slug) values (b, 'Inbox signals', 'inbox-signals-test'), (other_b, 'Other', 'inbox-signals-other');
  insert into customers(id, business_id, display_name) values (cu, b, 'Ana');
  insert into conversations(id, business_id, customer_id, channel, instagram_participant_id, status) values
    (echo_c, b, cu, 'instagram', 'p-echo', 'paused'),
    (waiting_c, b, null, 'instagram', 'p-wait', 'active'),
    (failed_c, b, null, 'instagram', 'p-fail', 'active'),
    (import_c, b, null, 'instagram', 'p-import', 'completed'),
    (profile_c, b, null, 'instagram', 'p-profile', 'active'),
    (foreign_c, other_b, null, 'instagram', 'p-foreign', 'active');
  insert into messages(business_id, conversation_id, direction, source, body, sent_via, delivery_status, created_at) values
    (b, echo_c, 'inbound', 'customer', 'Numri im: +355 69 123 4567', null, null, now() - interval '10 minutes'),
    (b, echo_c, 'outbound', 'staff', 'Faleminderit!', 'instagram_app', 'sent', now() - interval '5 minutes'),
    (b, waiting_c, 'outbound', 'agent', 'Përshëndetje', null, 'delivered', now() - interval '10 minutes'),
    (b, waiting_c, 'inbound', 'customer', 'Kosto 1500 - 2000? ana@example.com', null, null, now() - interval '5 minutes'),
    (b, failed_c, 'inbound', 'customer', 'Hello', null, null, now() - interval '10 minutes'),
    (b, failed_c, 'outbound', 'staff', 'Hi', null, 'failed', now() - interval '5 minutes'),
    (b, import_c, 'inbound', 'customer', 'Pyetje', null, null, now() - interval '3 days'),
    (b, import_c, 'outbound', 'staff', 'Përgjigje', 'instagram_app', 'sent', now() - interval '2 days'),
    (b, profile_c, 'inbound', 'customer', 'Po', null, null, now()),
    (other_b, foreign_c, 'inbound', 'customer', '+355 69 999 9999', null, null, now());
  insert into conversation_profiles(business_id, participant_id, connection_id, channel, profile)
    values (b, 'p-profile', gen_random_uuid(), 'instagram', '{"email":{"value":"x@y.al","validated":true}}');
  insert into orders(business_id, conversation_id, customer_id, status) values
    (b, echo_c, cu, 'confirmed'), (b, null, cu, 'submitted'), (b, echo_c, cu, 'failed');
  insert into leads(business_id, customer_id, conversation_id, source, status) values (b, cu, echo_c, 'manual', 'contacted');

  -- A foreign business id reads nothing; a foreign conversation in the list is dropped.
  if exists(select 1 from inbox_row_signals(other_b, array[echo_c])) then raise exception 'Cross-tenant read'; end if;
  if exists(select 1 from inbox_row_signals(b, array[foreign_c])) then raise exception 'Foreign conversation read'; end if;

  select * into r from inbox_row_signals(b, array[echo_c]);
  if r.last_reply_at is null or r.last_reply_at < r.last_customer_at then raise exception 'App echo not counted as reply'; end if;
  if not r.has_phone or r.has_email then raise exception 'Phone format check wrong'; end if;
  if r.order_count <> 2 then raise exception 'Expected 2 orders, got %', r.order_count; end if;
  if r.lead_status <> 'contacted' or not r.customer_linked then raise exception 'Lead/customer flags wrong'; end if;

  select * into r from inbox_row_signals(b, array[waiting_c]);
  if r.last_customer_at <= r.last_reply_at then raise exception 'Later customer message not awaiting'; end if;
  if r.has_phone then raise exception 'A price range is not a phone number'; end if;
  if not r.has_email then raise exception 'Email not detected'; end if;

  select * into r from inbox_row_signals(b, array[failed_c]);
  if r.last_reply_at is not null then raise exception 'Failed send counted as reply'; end if;

  select * into r from inbox_row_signals(b, array[import_c]);
  if r.last_reply_at < r.last_customer_at then raise exception 'Imported reply not counted'; end if;

  select * into r from inbox_row_signals(b, array[profile_c]);
  if not r.has_email or r.customer_linked or r.order_count <> 0 or r.lead_status is not null then raise exception 'Profile/unlinked flags wrong'; end if;

  if has_function_privilege('authenticated', 'inbox_row_signals(uuid,uuid[])', 'execute')
    or has_function_privilege('anon', 'inbox_row_signals(uuid,uuid[])', 'execute') then
    raise exception 'Signals RPC exposed';
  end if;
end $$;
rollback;
