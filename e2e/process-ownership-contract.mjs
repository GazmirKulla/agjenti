import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function verifyProcessOwnership({ sql, literal, json, root, business, conversation }) {
  sql(`alter table workflow_inbound_queue add column external_id text;
    alter table messages add column external_message_id text, add column whatsapp_connection_id uuid, add column instagram_connection_id uuid;`);
  const transport = readFileSync(path.join(root, 'supabase/migrations/20261022221309_conversation_transport_reliability.sql'), 'utf8');
  sql(transport.slice(transport.indexOf('create function public.workflow_inbound_original_conversation('), transport.indexOf('-- Older server deployments')));
  sql(readFileSync(path.join(root, 'supabase/migrations/20261107010000_process_ownership.sql'), 'utf8'));
  const user = '10000000-0000-4000-8000-000000000001';
  const state = { schemaVersion: 4, mode: 'live', businessId: business, conversationId: conversation, revision: 80, focusId: 'review',
    offers: { old: { id: 'old' } }, pendingTurn: { eventId: 'old-job' }, instances: {
      review: { id: 'review', status: 'waiting_approval', stepId: 'confirm', facts: { name: { value: 'Customer' } }, wait: { id: 'old-wait' }, approval: { waitId: 'old-wait' } },
      prepared: { id: 'prepared', status: 'waiting_effect', stepId: 'write', facts: {}, action: { status: 'prepared', approval: { stepId: 'confirm' } } },
      uncertain: { id: 'uncertain', status: 'waiting_effect', stepId: 'write', facts: {}, action: { id: 'receipt', status: 'unknown', inputDigest: 'immutable' } },
    } };
  sql(`insert into platform_admins(user_id) values(${literal(user)});
    update workflow_inbound_queue set status='sent' where conversation_id=${literal(conversation)};
    update conversations set status='active',auto_reply=true where id=${literal(conversation)};
    update conversation_states set revision=80,collected=${json(state)} where conversation_id=${literal(conversation)};
    update conversations set status='paused',auto_reply=false where id=${literal(conversation)};`);
  const read = () => JSON.parse(sql(`select collected from conversation_states where conversation_id=${literal(conversation)};`));
  const paused = read();
  assert.equal(paused.revision, 81);
  assert.equal(paused.instances.review.status, 'suspended');
  assert.deepEqual(paused.instances.review.facts, state.instances.review.facts);
  assert.equal(paused.instances.review.wait, undefined);
  assert.equal(paused.instances.review.approval, undefined);
  assert.equal(paused.instances.prepared.action, undefined);
  assert.equal(paused.instances.prepared.stepId, 'confirm');
  assert.deepEqual(paused.instances.uncertain.action, state.instances.uncertain.action);
  assert.equal(paused.pendingTurn, undefined);
  assert.deepEqual(paused.offers, {});
  const resume = (revision, actor = user) => `set role service_role; select public.resume_conversation_agent(${literal(business)},${literal(actor)},${literal(conversation)},${revision});`;
  assert.throws(() => sql(resume(80)), /stale_state/);
  assert.throws(() => sql(resume(81, '20000000-0000-4000-8000-000000000001')), /unauthorized/);
  assert.equal(sql(resume(81)), '82');
  assert.equal(read().revision, 82);
  assert.equal(sql(`select revision from conversation_states where conversation_id=${literal(conversation)};`), '82');
  assert.equal(read().instances.review.status, 'suspended');
  assert.deepEqual(read().instances.uncertain.action, state.instances.uncertain.action);
  sql(`update conversations set status='paused',auto_reply=false where id=${literal(conversation)};
    update conversation_states set revision=90,collected='{"schemaVersion":3,"fields":{"old":"value"}}'::jsonb where conversation_id=${literal(conversation)};`);
  assert.equal(sql(resume(90)), '91');
  assert.deepEqual(read(), { schemaVersion: 4, mode: 'live', businessId: business, conversationId: conversation,
    revision: 91, instances: {}, offers: {}, focusId: null });
}
