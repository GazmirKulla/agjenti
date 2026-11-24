import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Exercise the channel guard and the production calendar writer together in the disposable database.
export function verifyBookingGuard({ sql, literal, json, root, business, conversation, token }) {
  const migration = name => readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
  sql(`alter table businesses add column name text, add column slug text, add column agent_collection_policy jsonb;
    create function is_business_member(uuid) returns boolean language sql as $$ select false $$;
    create function is_platform_admin() returns boolean language sql as $$ select false $$;
    create table knowledge_entries(id uuid primary key default gen_random_uuid(),business_id uuid,title text,body text,intent_key text,is_active boolean,updated_at timestamptz);
    create table workflow_booking_effects(job_id bigint,business_id uuid,conversation_id uuid,request_key text,booking_id uuid,unique(business_id,request_key));`);
  sql(migration('20261010090000_calendar_bookings.sql'));
  sql(migration('20261010100000_business_services.sql'));
  sql(readFileSync(path.join(root, 'supabase/tests/calendar_bookings.sql'), 'utf8'));
  sql('alter table bookings add column conversation_id uuid references conversations(id);');
  const changes = migration('20261121120000_customer_booking_changes.sql');
  const start = changes.indexOf('create or replace function public.save_workflow_booking(');
  const end = changes.indexOf('create or replace function public.change_workflow_booking(');
  assert.ok(start >= 0 && end > start);
  sql(changes.slice(start, end));
  const date = sql("select (current_date + 2)::text");
  const service = randomUUID(), actionId = randomUUID();
  const input = { serviceId: service, serviceName: 'Consultation', durationMinutes: 30, bufferMinutes: 10,
    timezone: 'UTC', confirmationMode: 'manual', name: 'Example Customer', contact: 'customer@example.test', date, time: '10:00' };
  const action = { id: actionId, tool: 'booking.create', toolVersion: 1, status: 'running', input, approval: { expiresAt: Date.now() + 600000 } };
  const state = { schemaVersion: 4, mode: 'live', businessId: business, conversationId: conversation, instances: { instance: { versionId: 'version', action } } };
  const setState = value => sql(`update conversation_states set collected=${json(value)},revision=10 where conversation_id=${literal(conversation)};`);
  sql(`insert into booking_services(id,business_id,name,duration_minutes,buffer_minutes,is_active,booking_enabled) values(${literal(service)},${literal(business)},'Consultation',30,10,true,true);
    insert into business_calendar_settings(business_id,timezone,confirmation_mode,agent_booking_enabled,hours)
      values(${literal(business)},'UTC','manual',true,(select jsonb_agg(jsonb_build_object('day',n,'start','09:00','end','17:00')) from generate_series(0,6)n));
    update workflow_inbound_queue set leased_until=now()+interval '10 minutes',status='processing' where id=1;`);
  setState(state);
  const call = `select public.save_workflow_booking(1,${literal(token)},${literal(conversation)},10,${literal(service)},'Example Customer','customer@example.test','${date}T10:00:00Z','pending','',${literal(`ig:${conversation}:${actionId}`)});`;
  sql('update booking_services set duration_minutes=45;');
  assert.throws(() => sql(call), /booking_terms_changed/);
  assert.equal(sql('select count(*) from bookings;'), '0');
  sql('update booking_services set duration_minutes=30;');
  setState({ ...state, instances: { instance: { action: { ...action, approval: { expiresAt: 0 } } } } });
  assert.throws(() => sql(call), /invalid_booking_effect/);
  setState({ ...state, businessId: randomUUID() });
  assert.throws(() => sql(call), /invalid_booking_effect/);
  setState(state);
  assert.throws(() => sql(call.replace("'pending'", "'confirmed'")), /invalid_booking_effect/);
  assert.throws(() => sql(call.replace('10:00:00Z', '11:00:00Z')), /invalid_booking_effect/);
  assert.equal(sql('select count(*) from bookings;'), '0');
  sql(`update businesses set agent_collection_policy='{"scopes":[{"versionId":"version","mode":"collection_only"}]}' where id=${literal(business)};`);
  assert.throws(() => sql(call), /collection_effect_denied/);
  sql(`update businesses set agent_collection_policy=null where id=${literal(business)};`);
  setState({ ...state, mode: null });
  assert.throws(() => sql(call), /invalid_booking_effect/);
  setState(state);
  sql(call); sql(call);
  assert.equal(sql('select count(*) from bookings;'), '1');
  assert.equal(sql('select count(*) from workflow_booking_effects;'), '1');
  assert.equal(sql('select conversation_id from bookings;'), conversation);
  // A second Meta channel uses the same guard, calendar and stable request-key contract.
  sql("update conversations set channel='whatsapp',whatsapp_participant_id='wa-client',whatsapp_connection_id=instagram_connection_id;" +
      "update workflow_inbound_queue set channel='whatsapp',participant_id='wa-client' where id=1;");
  action.id = randomUUID();
  setState(state);
  const second = call.replace(actionId, action.id);
  assert.throws(() => sql(second), /bookings_no_overlap/);
  input.time = '15:00';
  setState(state);
  sql(second.replace('10:00:00Z','15:00:00Z'));
  assert.equal(sql('select count(*) from bookings;'), '2');
  console.log('PASS: real calendar hours, busy slots, buffer and committed bookings for both Meta channel guards.');
  console.log('PASS: booking guard rejects changed terms, expired approval, foreign scope and changed input; replay produces one booking.');
}
