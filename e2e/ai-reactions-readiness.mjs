// Planning checkpoint, not an AI reaction implementation or live certification.
// Exercises the EXISTING manual RPCs in isolated PostgreSQL/Auth/PostgREST.
// EXPECTED_GAP checks document why AI must not reuse manual authorization.
// No migrations, AI calls, provider HTTP, worker claims or shared fixture edits.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { work, project, verifyContainers, localKeys } from './local.mjs';

assert.equal(project, 'agjenti-e2e-local-messages-20261024');
verifyContainers();
const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const keys = localKeys(), [owner, outsider] = fixtures.tenants;
const localFetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.origin, keys.api, 'Only verified local Auth/PostgREST is allowed');
  return fetch(input, { ...init, redirect: 'error' });
};
const client = key => createClient(keys.api, key, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch },
});
const db = client(keys.service), member = client(keys.anon), foreign = client(keys.anon);
const ok = async promise => {
  const result = await promise;
  assert.equal(result.error, null, result.error?.message);
  return result.data;
};
const denied = async (promise, reason) => {
  const result = await promise;
  assert.ok(result.error, 'Expected rejection');
  assert.match(result.error.message, reason);
};
let checks = 0, gaps = 0;
const pass = text => { checks++; console.log(`PASS ${text}`); };
const gap = text => { gaps++; console.log(`EXPECTED_GAP (not AI acceptance): ${text}`); };
const connection = randomUUID();
const targets = [
  { conversation: randomUUID(), message: randomUUID(), status: 'active', auto: false },
  { conversation: randomUUID(), message: randomUUID(), status: 'paused', auto: true },
];
const params = (target, revision, emoji, request = randomUUID(), user = owner.userId) => ({
  p_business: owner.id, p_user: user, p_conversation: target.conversation,
  p_message: target.message, p_request: request, p_revision: revision, p_emoji: emoji,
});
const reserve = args => db.rpc('reserve_message_reaction', args);
const finishSynthetic = (request, token, status = 'sent') => ok(db.rpc('finish_message_reaction', {
  p_request: request, p_token: token, p_status: status, p_external: null,
  p_error: status === 'failed' ? 'Synthetic rejection; no provider called' : null,
}));
const read = target => ok(db.rpc('read_message_reactions', {
  p_business: owner.id, p_user: owner.userId, p_conversation: target.conversation,
}));
const snapshot = async target => ({
  conversation: await ok(db.from('conversations').select('status,auto_reply').eq('id', target.conversation).single()),
  state: await ok(db.from('conversation_states').select('collected,revision').eq('conversation_id', target.conversation).single()),
  messages: await ok(db.from('messages').select('id,body,direction,source').eq('conversation_id', target.conversation)),
  jobs: await ok(db.from('workflow_inbound_queue').select('id').eq('conversation_id', target.conversation)),
});

try {
  await ok(member.auth.signInWithPassword({ email: owner.email, password: fixtures.password }));
  await ok(foreign.auth.signInWithPassword({ email: outsider.email, password: fixtures.password }));
  await ok(db.from('instagram_connections').insert({
    id: connection, business_id: owner.id, ig_user_id: connection,
    access_token_ciphertext: 'synthetic-not-a-credential', status: 'connected',
  }));
  for (const target of targets) {
    await ok(db.from('conversations').insert({
      id: target.conversation, business_id: owner.id, instagram_connection_id: connection,
      instagram_participant_id: `synthetic-${target.conversation}`, channel: 'instagram',
      status: target.status, auto_reply: target.auto, last_inbound_at: new Date().toISOString(),
    }));
    await ok(db.from('messages').insert({
      id: target.message, business_id: owner.id, conversation_id: target.conversation,
      instagram_connection_id: connection, external_message_id: `synthetic-${target.message}`,
      direction: 'inbound', source: 'customer', body: 'Faleminderit!',
    }));
    await ok(db.from('conversation_states').insert({
      business_id: owner.id, conversation_id: target.conversation, revision: 7,
      collected: { syntheticFact: 'unchanged', confirmation: 'not-an-approval' },
    }));
  }
  const before = await Promise.all(targets.map(snapshot));
  const [first, second] = targets;
  await denied(reserve(params(first, 0, '👍', randomUUID(), null)), /reaction_forbidden/);
  await denied(reserve(params(first, 0, '👍', randomUUID(), outsider.userId)), /reaction_forbidden/);
  await denied(member.rpc('reserve_message_reaction', params(first, 0, '👍')), /permission denied/);
  assert.deepEqual(await read(first), []);
  pass('no anonymous AI identity, foreign operator or client-side privileged RPC access');

  await denied(reserve({ ...params(first, 0, '👍'), p_conversation: second.conversation }), /reaction_target_invalid/);
  await denied(reserve({ ...params(first, 0, '👍'), p_business: outsider.id, p_user: outsider.userId }), /reaction_target_invalid/);
  pass('valid message UUID cannot be reused across conversation or tenant boundaries');

  // These are permitted HUMAN actions, not defects in the manual RPC. An AI
  // caller borrowing the member identity would bypass its required policy gate.
  for (const target of targets) {
    const request = randomUUID();
    const claim = await ok(reserve(params(target, 0, '👍', request)));
    assert.equal(claim.claimed, true);
    await finishSynthetic(request, claim.token);
    assert.equal((await read(target))[0].emoji, '👍');
    gap(target.auto === false
      ? 'manual reservation accepts auto_reply=false; AI needs a separate policy check'
      : 'manual reservation accepts paused/staff ownership; AI needs a current ownership fence');
  }
  assert.equal((await ok(member.from('message_reactions').select('id').eq('message_id', first.message))).length, 1);
  assert.deepEqual(await ok(foreign.from('message_reactions').select('id').eq('message_id', first.message)), []);
  pass('real authenticated RLS isolates the shared business reaction');

  await denied(reserve(params(first, 0, '❤️')), /reaction_revision_conflict/);
  pass('a proposal captured before a manual change cannot overwrite its newer revision');

  const removal = randomUUID(), removed = await ok(reserve(params(first, 1, '', removal)));
  await finishSynthetic(removal, removed.token);
  const tombstone = (await read(first))[0];
  assert.equal(tombstone.emoji, '');
  assert.equal(tombstone.revision, 2);
  assert.equal(tombstone.requestId, removal);
  assert.deepEqual(await ok(db.from('message_reaction_operations').select('user_id,emoji,status')
    .eq('id', removal).single()), { user_id: owner.userId, emoji: '', status: 'sent' });
  await denied(reserve(params(first, 1, '❤️')), /reaction_revision_conflict/);
  pass('manual removal retains operator/revision history; empty emoji does not mean untouched');

  // CAS alone is NOT a "manual wins" policy: after reading the current revision,
  // another authorized manual operation is allowed. Do not impersonate it as AI.
  const next = randomUUID(), afterRemoval = await ok(reserve(params(first, 2, '❤️', next)));
  assert.equal(afterRemoval.claimed, true);
  await finishSynthetic(next, afterRemoval.token, 'failed');
  assert.equal((await read(first))[0].emoji, '');
  gap('current-revision manual reservation can follow manual removal; AI ownership priority is absent');

  for (const [index, target] of targets.entries()) assert.deepEqual(await snapshot(target), before[index]);
  pass('reaction operations create no messages/jobs and leave facts, confirmation and staff state untouched');
  console.log(`${checks} PASS existing boundaries; ${gaps} confirmed automation gaps. AI decisioning/live behavior UNVERIFIED.`);
} finally {
  // Only random IDs created by this script; never reset shared tenants or schema.
  for (const target of targets) await ok(db.from('conversations').delete().eq('id', target.conversation).eq('business_id', owner.id));
  await ok(db.from('instagram_connections').delete().eq('id', connection).eq('business_id', owner.id));
  await ok(member.auth.signOut());
  await ok(foreign.auth.signOut());
}
