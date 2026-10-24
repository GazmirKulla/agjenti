// Real LOCAL PostgreSQL/PostgREST queue tests. No AI/provider HTTP or schema DDL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { work, project, verifyContainers, localKeys } from './local.mjs';
assert.equal(project, 'agjenti-e2e-local-messages-20261024');
verifyContainers();
const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const [tenant, other] = fixtures.tenants, keys = localKeys();
const db = createClient(keys.api, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });
const owner = createClient(keys.api, keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });
const ok = async p => { const r = await p; assert.equal(r.error, null, r.error?.message); return r.data; };
const rpc = (name, args) => ok(db.rpc(name, args));
const connections = [], streams = [];
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };
const fragments = ['pse', 'ti psh', 'mund ta kuptosh', 'cfare po t them', 'kur t shkruaj mesazhe', 'tek e tek', '?'];
const stamp = age => new Date(Date.now() - age).toISOString();
async function fixture(channel, business = tenant.id, user = tenant.userId) {
  const scope = { channel, business, user, id: randomUUID(), person: randomUUID(), sequence: 0 };
  if (channel === 'test') streams.push(scope.id);
  else {
    connections.push(scope);
    await ok(db.from(`${channel}_connections`).insert({ id: scope.id, business_id: business,
      ...(channel === 'instagram' ? { ig_user_id: scope.id } : { phone_number_id: scope.id, waba_id: 'synthetic' }),
      access_token_ciphertext: 'synthetic', status: 'connected' }));
  }
  return scope;
}
async function enqueue(scope, text, kind = 'fragment') {
  if (scope.channel === 'test') return rpc('enqueue_transport_operation', {
    p_business: scope.business, p_user: scope.user, p_request: randomUUID(), p_kind: 'test', p_scope: scope.id,
    p_sequence: scope.sequence++, p_fingerprint: 'a'.repeat(64),
    p_payload: { slug: tenant.slug, message: text, attachments: [], ...(kind ? {fragmentKind:kind} : {}) },
  });
  return ok(db.from('workflow_inbound_queue').insert({ business_id: scope.business, channel: scope.channel,
    connection_id: scope.id, participant_id: scope.person, external_id: randomUUID(),
    payload: { channel: scope.channel, text, ...(kind ? {fragmentKind:kind} : {}), timestamp: stamp(0), attachments: [] },
  }).select('*').single());
}
const legacyClaim = scope => rpc('claim_workflow_transport', { p_businesses: [scope.business],
  p_test_user: scope.channel === 'test' ? scope.user : null, p_test_stream: scope.channel === 'test' ? scope.id : null });
const claim = scope => rpc('claim_workflow_transport', { p_businesses: [scope.business], p_fragments: true,
  p_test_user: scope.channel === 'test' ? scope.user : null, p_test_stream: scope.channel === 'test' ? scope.id : null });
const age = (jobs, ms) => ok(db.from('workflow_inbound_queue').update({ created_at: stamp(ms) }).in('id', jobs.map(j => j.id)));
const removeJobs = jobs => ok(db.from('workflow_inbound_queue').delete().in('id', jobs.map(j => j.id)));
try {
  await ok(owner.auth.signInWithPassword({email:tenant.email,password:fixtures.password}));
  for (const channel of ['instagram', 'whatsapp', 'test']) {
    const scope = await fixture(channel);
    const legacy = await enqueue(scope, 'legacy input', null);
    assert.equal((await legacyClaim(scope))[0].id, legacy.id);
    await removeJobs([legacy]);
    pass(`${channel}: SQL-first deployment preserves old unmarked jobs`);
    const jobs = [await enqueue(scope, fragments[0])];
    assert.deepEqual(await claim(scope), [], 'A fresh fragment must wait, not start its own generation');
    pass(`${channel}: real claim honors the quiet window`);
    await age(jobs, 2800);
    jobs.push(await enqueue(scope, fragments[1]));
    assert.deepEqual(await claim(scope), [], 'A new fragment must reset the bounded quiet window');
    for (const text of fragments.slice(2)) jobs.push(await enqueue(scope, text, text === '?' ? 'close' : 'fragment'));
    await age(jobs, 4000);
    assert.deepEqual(await legacyClaim(scope), [], 'An old worker must not claim new fragments during rollout');
    const claims = await Promise.all(Array.from({ length: 12 }, (_,i) => i%2 ? legacyClaim(scope) : claim(scope)));
    assert.equal(claims.flat().length, 1);
    const leader = claims.flat()[0];
    assert.equal(leader.id, jobs[0].id);
    assert.deepEqual(leader.batch_payloads.map(p => p.text ?? p.message), fragments);
    const rows = await ok(db.from('workflow_inbound_queue').select('id,status,batch_parent_id').in('id', jobs.map(j => j.id)).order('id'));
    assert.deepEqual(rows.map(r => r.status), ['processing', ...Array(6).fill('batched')]);
    assert.ok(rows.slice(1).every(r => r.batch_parent_id === leader.id));
    pass(`${channel}: six workers freeze one ordered seven-fragment generation`);
    const later = await enqueue(scope, 'Pyetje tjetër?', 'separate');
    assert.deepEqual(await claim(scope), []);
    await ok(db.from('workflow_inbound_queue').update({ leased_until: stamp(200000) }).eq('id', leader.id));
    assert.deepEqual(await legacyClaim(scope), [], 'Old worker cannot reclaim a frozen batch');
    const retried = (await claim(scope))[0];
    assert.equal(retried.id, leader.id); assert.notEqual(retried.lease_token, leader.lease_token);
    assert.deepEqual(retried.batch_payloads, leader.batch_payloads);
    pass(`${channel}: mixed old/new workers and retries cannot cross the protocol fence`);
    pass(`${channel}: later arrival waits; expired lease reuses frozen membership, never absorbs it`);
    await removeJobs([...jobs, later]);

    const first = await enqueue(scope, 'po mundohem');
    await age([first], 11000);
    const second = await enqueue(scope, 'te kuptoj');
    const third = await enqueue(scope, 'cfare po ndodh');
    await age([second], 9000);
    await age([third], 7000);
    const capped = (await claim(scope))[0];
    assert.equal(capped.id, first.id); assert.equal(capped.batch_payloads.length, 3);
    pass(`${channel}: ten-second maximum prevents endless waiting`);
    await removeJobs([first, second, third]);

    const before = await enqueue(scope, 'fragment');
    const boundary = await enqueue(scope, 'Sa kushton produkti?', 'separate');
    const after = await enqueue(scope, 'fragment tjetër');
    await age([before, boundary, after], 4000);
    assert.equal((await claim(scope))[0].batch_payloads.length, 1);
    await removeJobs([before]);
    const isolated = (await claim(scope))[0];
    assert.equal(isolated.id, boundary.id); assert.equal(isolated.batch_payloads, null);
    pass(`${channel}: complete question is a hard boundary, not silently merged with neighbors`);
    await removeJobs([boundary, after]);

    const gap = await enqueue(scope, 'pse');
    await age([gap], 8000);
    const independent = await enqueue(scope, 'po mundohem');
    const separated = (await claim(scope))[0];
    assert.equal(separated.batch_payloads.length, 1);
    assert.equal(separated.id, gap.id);
    pass(`${channel}: quiet gap separates bursts even when a worker was busy`);
    await removeJobs([gap, independent]);

    const cappedJobs=[];
    for(let i=0;i<21;i++)cappedJobs.push(await enqueue(scope, 'fragment'));
    await age(cappedJobs, 4000);
    assert.equal((await claim(scope))[0].batch_payloads.length,20);
    assert.equal((await ok(db.from('workflow_inbound_queue').select('status').eq('id',cappedJobs[20].id).single())).status,'queued');
    pass(`${channel}: twenty-message cap retains the next raw message`);
    await removeJobs(cappedJobs);
  }
  const a = await fixture('test'), b = await fixture('test', other.id, other.userId);
  const left = await enqueue(a, 'pse'), right = await enqueue(b, 'te kuptoj');
  await age([left, right], 4000);
  const mine = (await claim(a))[0];
  assert.equal(mine.batch_payloads.length, 1); assert.equal(mine.business_id, tenant.id);
  assert.deepEqual(await rpc('claim_workflow_transport', { p_businesses: [tenant.id], p_test_user: other.userId, p_test_stream: b.id }), []);
  assert.equal((await claim(b))[0].id, right.id);
  pass('private stream/user/tenant claims never combine or steal another stream');
  assert.ok((await owner.rpc('workflow_fragment_window',{p_id:mine.id})).error);
  assert.ok((await owner.rpc('workflow_fragment_wait_ms',{p_businesses:[tenant.id],p_test_user:tenant.userId,p_test_stream:a.id})).error);
  assert.ok((await owner.rpc('claim_workflow_transport',{p_businesses:[tenant.id],p_test_user:tenant.userId,p_test_stream:a.id,p_fragments:true})).error);
  pass('authenticated role cannot inspect or execute privileged batch RPCs');
  await ok(db.from('workflow_inbound_queue').update({leased_until:stamp(200000)}).eq('id',mine.id));
  const retry=(await claim(a))[0];
  assert.ok((await db.rpc('finish_test_transport',{p_id:mine.id,p_token:mine.lease_token,p_result:'stale',p_error:null})).error);
  await rpc('finish_test_transport',{p_id:mine.id,p_token:retry.lease_token,p_result:'sealed-synthetic',p_error:null});
  assert.equal((await ok(db.from('workflow_inbound_queue').select('result_ciphertext').eq('id',mine.id).single())).result_ciphertext,'sealed-synthetic');
  pass('frozen private batch rejects stale completion and persists one current outcome');
  const upgraded=await fixture('test');
  const group=[await enqueue(upgraded,'pse'),await enqueue(upgraded,'te kuptoj')];
  await age(group,4000);
  const root=(await claim(upgraded))[0];
  await rpc('finish_test_transport',{p_id:root.id,p_token:root.lease_token,p_result:'sealed-synthetic',p_error:null});
  const oldTab=await enqueue(upgraded,'question from old deployment',null);
  assert.deepEqual(await legacyClaim(upgraded),[],'Legacy result lookup cannot follow a batched child');
  assert.equal((await claim(upgraded))[0].id,oldTab.id);
  pass('private history with batches requires a capable worker even for later old-tab requests');
  console.log(`${checks} PASS real local queue boundaries; AI/provider behavior not exercised.`);
} finally {
  for (const stream of streams) await ok(db.from('workflow_inbound_queue').delete().eq('test_stream_id', stream));
  for (const scope of connections) {
    await ok(db.from('workflow_inbound_queue').delete().eq('connection_id', scope.id));
    await ok(db.from(`${scope.channel}_connections`).delete().eq('id', scope.id));
  }
}
