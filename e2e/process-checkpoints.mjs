// Focused PostgreSQL contract test. The dependency fixture is NOT a full Supabase replay.
// Creates its own temporary cluster with Unix sockets only; never reads project env files.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.env.PROCESS_TEST_PG_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
// macOS Unix socket paths have a short size limit; its default TMPDIR is too long.
const work = mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'agjenti-process-pg-'));
const data = path.join(work, 'data');
const socket = path.join(work, 'socket');
mkdirSync(socket, { mode: 0o700 });
const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'TMPDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
env.LC_ALL = 'C';
function run(name, args, input) {
  const r = spawnSync(path.join(bin, name), args, { encoding: 'utf8', env, input, maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${name}: ${r.stderr || r.error}`);
  return r.stdout.trim();
}
const args = ['-X', '-qAt', '-h', socket, '-p', '55439', '-U', 'process_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
const sql = input => run('psql', args, input);
function concurrent(input) {
  return new Promise(resolve => {
    const child = spawn(path.join(bin, 'psql'), args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr }));
    child.stdin.end(input);
  });
}
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
let started = false;
try {
  run('initdb', ['-D', data, '-U', 'process_test', '--auth=trust', '--no-locale', '--encoding=UTF8']);
  try { run('pg_ctl', ['-D', data, '-l', path.join(work, 'postgres.log'), '-o', `-k ${socket} -p 55439 -c listen_addresses=''`, '-w', 'start']); }
  catch (error) { throw new Error(`${error.message}\n${readFileSync(path.join(work, 'postgres.log'), 'utf8')}`); }
  started = true;
  sql(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.businesses(id uuid primary key,auto_reply boolean not null default true);
    create table public.business_users(business_id uuid,user_id uuid,role text);
    create table public.platform_admins(user_id uuid);
    create table public.conversations(id uuid primary key,business_id uuid references businesses(id),channel text,status text default 'active',auto_reply boolean,
      instagram_participant_id text,instagram_connection_id uuid,whatsapp_participant_id text,whatsapp_connection_id uuid,panel_user_id uuid,panel_stream_id uuid);
    create table public.conversation_states(conversation_id uuid primary key references conversations(id),business_id uuid references businesses(id),
      collected jsonb not null default '{}',revision integer not null default 0,workflow_id uuid,step_key text,status text default 'in_progress',updated_at timestamptz);
    create table public.workflow_inbound_queue(id bigint generated always as identity primary key,business_id uuid references businesses(id),lease_token uuid,
      leased_until timestamptz,status text,conversation_id uuid references conversations(id),channel text,operation_kind text,participant_id text,connection_id uuid,
      operator_user_id uuid,test_stream_id uuid,reply text);
    grant usage on schema public to anon,authenticated,service_role;
  `);
  // Load the actual tenant/channel matching functions, not mocked authorization.
  const panel = readFileSync(path.join(root, 'supabase/migrations/20261104215508_panel_real_chat.sql'), 'utf8');
  const from = panel.indexOf('create function public.can_use_panel_chat(');
  const to = panel.indexOf('create or replace function public.provision_business_invitation(');
  assert.ok(from >= 0 && to > from);
  sql(panel.slice(from, to));
  sql(readFileSync(path.join(root, 'supabase/migrations/20261105220000_process_checkpoints.sql'), 'utf8'));
  const business = randomUUID(), foreign = randomUUID(), conversation = randomUUID(), connection = randomUUID(), token = randomUUID();
  sql(`insert into businesses(id) values(${literal(business)}),(${literal(foreign)});
    insert into conversations(id,business_id,channel,instagram_participant_id,instagram_connection_id) values(${literal(conversation)},${literal(business)},'instagram','customer',${literal(connection)});
    insert into conversation_states(conversation_id,business_id) values(${literal(conversation)},${literal(business)});
    insert into workflow_inbound_queue(business_id,lease_token,leased_until,status,conversation_id,channel,operation_kind,participant_id,connection_id)
      values(${literal(business)},${literal(token)},now()+interval '10 minutes','processing',${literal(conversation)},'instagram','inbound','customer',${literal(connection)});`);
  const base = { schemaVersion: 4, mode: 'live', businessId: business, conversationId: conversation, revision: 1, instances: {}, offers: {}, focusId: null };
  function commit(event, revision, state, reply = null, targets = [], tenant = business, hash = 'a'.repeat(64)) {
    return `set role service_role; select public.commit_process_checkpoint(${literal(tenant)},${literal(conversation)},1,${literal(token)},${literal(event)},${literal(hash)},${revision},${json(state)},${reply === null ? 'null' : literal(reply)},${json(targets)});`;
  }
  const read = () => JSON.parse(sql('select collected from conversation_states;'));
  assert.throws(() => sql(commit('foreign', 0, base, null, [], foreign)), /lease_lost/);
  assert.equal(sql('select revision from conversation_states;'), '0');
  assert.throws(() => sql(`set role authenticated; select public.commit_process_checkpoint(null,null,null,null,null,null,null,null);`), /permission denied/);
  assert.equal(sql(`select count(*) from pg_policies where tablename='process_event_receipts';`), '0');

  const attempts = await Promise.all([concurrent(commit('same-event', 0, base)), concurrent(commit('same-event', 0, base))]);
  assert.deepEqual(attempts.map(a => a.code), [0, 0]);
  assert.deepEqual(attempts.map(a => JSON.parse(a.stdout).replayed).sort(), [false, true]);
  assert.equal(sql('select count(*) from process_event_receipts;'), '1');
  assert.equal(sql('select revision from conversation_states;'), '1');
  assert.throws(() => sql(commit('same-event', 0, base, null, [], business, 'b'.repeat(64))), /event_conflict/);
  assert.throws(() => sql(commit('stale', 0, base)), /stale_state/);
  assert.throws(() => sql(commit('invalid', 1, { ...base, businessId: foreign, revision: 2 })), /invalid_process_state/);
  assert.throws(() => sql(commit('test-in-live-outbox', 1, { ...base, mode: 'test', revision: 2 })), /invalid_process_state/);
  assert.throws(() => sql(commit('bad-target', 1, { ...base, revision: 2 }, 'Review', ['missing'])), /invalid_prompt_target/);
  assert.equal(sql('select count(*) from process_event_receipts;'), '1');
  assert.equal(sql('select status from workflow_inbound_queue;'), 'processing');
  assert.equal(read().revision, 1);

  const races = await Promise.all(['first', 'second'].map(event => concurrent(commit(event, 1, { ...base, revision: 2 }))));
  assert.equal(races.filter(r => r.code === 0).length, 1);
  assert.match(races.find(r => r.code !== 0).stderr, /stale_state/);
  assert.equal(read().revision, 2);

  const offered = { ...base, revision: 3, offers: { proposal: { id: 'proposal', definitionId: 'flow', versionId: 'v1', expiresAt: Date.now() + 60000 } } };
  const committed = JSON.parse(sql(commit('reply', 2, offered, 'Review these details', ['proposal'])));
  assert.equal(committed.replayed, false);
  assert.equal(sql('select status from workflow_inbound_queue;'), 'prepared');
  assert.equal(read().offers.proposal.presentedAt, undefined);
  const present = `set role service_role; select public.record_process_presentation(${literal(business)},1,${literal(token)});`;
  assert.throws(() => sql(present), /delivery_receipt_required/);
  sql("update workflow_inbound_queue set status='sent';"); // Simulates the verified transport receipt boundary.
  sql(present);
  assert.equal(typeof read().offers.proposal.presentedAt, 'number');
  assert.equal(read().revision, 4);
  assert.equal(JSON.parse(sql(present)).replayed, true);
  assert.equal(read().revision, 4);

  sql("update workflow_inbound_queue set status='processing',process_presented_at=null; update conversations set status='paused';");
  assert.throws(() => sql(commit('staff-owned', 4, { ...base, revision: 5 })), /ownership_lost/);
  sql("update conversations set status='active'; update workflow_inbound_queue set leased_until=now()-interval '1 second';");
  assert.throws(() => sql(commit('expired-lease', 4, { ...base, revision: 5 })), /lease_lost/);
  console.log('PASS: real PostgreSQL checkpoint CAS, concurrent deduplication, rollback, tenant/role isolation, ownership, lease and delivery receipts.');
  console.log('Scope: focused dependency fixture; full Supabase baseline and provider delivery are not tested here.');
} finally {
  if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
  rmSync(work, { recursive: true, force: true });
}
