import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Extends the disposable checkpoint fixture. The calendar writer is a stub:
// this verifies the real workflow guard, not calendar/provider functionality.
export function verifyBookingGuard({ sql, literal, json, root, business, conversation, token }) {
  sql(`create table booking_services(id uuid primary key,business_id uuid,name text,duration_minutes integer,buffer_minutes integer,is_active boolean,booking_enabled boolean);
    create table business_calendar_settings(business_id uuid primary key,timezone text,confirmation_mode text,agent_booking_enabled boolean);
    create table bookings(id uuid primary key,business_id uuid,request_key text);
    create table workflow_booking_effects(job_id bigint,business_id uuid,conversation_id uuid,request_key text,booking_id uuid,unique(business_id,request_key));
    create function save_calendar_booking(uuid,uuid,integer,uuid,text,text,timestamptz,text,text,text) returns bookings language plpgsql as $$
    declare b bookings; begin insert into bookings values(gen_random_uuid(),$1,$10) returning * into b; return b; end $$;`);
  sql(readFileSync(path.join(root, 'supabase/migrations/20261106130000_process_booking_terms.sql'), 'utf8'));
  sql('alter table businesses add column agent_collection_policy jsonb;');
  sql(readFileSync(path.join(root, 'supabase/migrations/20261106140000_process_booking_policy.sql'), 'utf8'));
  const service = randomUUID(), actionId = randomUUID();
  const input = { serviceId: service, serviceName: 'Consultation', durationMinutes: 30, bufferMinutes: 10,
    timezone: 'UTC', confirmationMode: 'manual', name: 'Example Customer', contact: 'customer@example.test', date: '2026-12-01', time: '10:00' };
  const action = { id: actionId, tool: 'booking.create', toolVersion: 1, status: 'running', input, approval: { expiresAt: Date.now() + 600000 } };
  const state = { schemaVersion: 4, mode: 'live', businessId: business, conversationId: conversation, instances: { instance: { versionId: 'version', action } } };
  const setState = value => sql(`update conversation_states set collected=${json(value)},revision=10 where conversation_id=${literal(conversation)};`);
  sql(`insert into booking_services values(${literal(service)},${literal(business)},'Consultation',30,10,true,true);
    insert into business_calendar_settings values(${literal(business)},'UTC','manual',true);
    update workflow_inbound_queue set leased_until=now()+interval '10 minutes',status='processing' where id=1;`);
  setState(state);
  const call = `select public.save_workflow_booking(1,${literal(token)},${literal(conversation)},10,${literal(service)},'Example Customer','customer@example.test','2026-12-01T10:00:00Z','pending','',${literal(`ig:${conversation}:${actionId}`)});`;
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
  console.log('PASS: booking guard rejects changed terms, expired approval, foreign scope and changed input; replay produces one booking.');
}
