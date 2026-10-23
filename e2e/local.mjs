import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, readdirSync, cpSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Separate opt-in instance; never repair/reset the default stack or its manifests.
const instance = process.env.E2E_INSTANCE ?? '';
assert.ok(!instance || /^[a-z][a-z0-9-]{0,31}$/.test(instance), 'Invalid local E2E instance');
export const work = path.join(root, '.e2e-local', ...(instance ? ['instances', instance] : []));
export const project = `agjenti-e2e-local${instance ? `-${instance}` : ''}`;
export const network = `agjenti_e2e_isolated${instance ? `_${instance}` : ''}`;
const cli = path.join(root, 'node_modules/.bin/supabase');
const stack = path.join(work, 'stack');
const dbContainer = `supabase_db_${project}`;
const hash = input => createHash('sha256').update(input).digest('hex');
// Deliberate allow-list: never inherit Supabase tokens, cloud/provider credentials,
// NODE_OPTIONS, proxy variables or the repo's .env.local into child applications.
export const safeEnv = () => Object.fromEntries(['PATH', 'HOME', 'USER', 'TMPDIR', 'SHELL'].filter(k => process.env[k]).map(k => [k, process.env[k]]).concat([
  ['DO_NOT_TRACK', '1'], ['NEXT_TELEMETRY_DISABLED', '1'], ['CI', '1'],
]));
export function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { cwd: root, env: safeEnv(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${path.basename(exe)} failed: ${result.stderr || result.error || 'see local log'}`);
  return result.stdout.trim();
}
function supabase(args) { return run(cli, [...args, '--workdir', stack, '--network-id', network]); }
export function sql(statement) {
  return run('docker', ['exec', '-i', dbContainer, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: statement });
}
function verifyNetwork() {
  const n = JSON.parse(run('docker', ['network', 'inspect', network]))[0];
  assert.equal(n.Internal, true);
  assert.equal(n.Options['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
  assert.equal(n.Labels['agjenti.e2e'], project);
}
export function verifyContainers() {
  verifyNetwork();
  const ids = run('docker', ['ps', '-q', '--filter', `label=com.supabase.cli.project=${project}`]).split('\n').filter(Boolean);
  assert.ok(ids.length >= 3, 'Local Supabase dependencies unavailable');
  for (const id of ids) {
    const c = JSON.parse(run('docker', ['inspect', id]))[0];
    assert.deepEqual(Object.keys(c.NetworkSettings.Networks), [network], 'Unexpected egress network');
    for (const ports of Object.values(c.NetworkSettings.Ports))
      for (const port of ports ?? []) assert.equal(port.HostIp, '127.0.0.1', 'Non-loopback port');
  }
  assert.equal(sql("select current_database()='postgres' and not exists(select 1 from pg_subscription);"), 't');
}
export function localKeys() {
  const status = JSON.parse(supabase(['status', '-o', 'json']));
  // Fail closed on CLI output changes; never fall back to a repo env file.
  const api = status.API_URL;
  assert.equal(api, 'http://127.0.0.1:55321');
  assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY, 'Local keys unavailable');
  return { api, anon: status.ANON_KEY, service: status.SERVICE_ROLE_KEY };
}
const manifestPath = path.join(work, 'migrations.json');
export function migrationSql(payload) {
  // Supabase applies each migration transactionally. Preserve files that already
  // own their transaction; otherwise TEMP ... ON COMMIT DROP needs this wrapper.
  const statements = payload.replace(/^\s*--[^\n]*$/gm, '').trimStart();
  return /^begin\s*;/i.test(statements) ? payload : `begin;\n${payload}\ncommit;`;
}
function replay() {
  const files = readdirSync(path.join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  const current = files.map(name => ({ name, sha256: hash(readFileSync(path.join(root, 'supabase/migrations', name))) }));
  if (existsSync(manifestPath)) {
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), current, 'Migration drift: use a separately reviewed fresh local stack');
    return;
  }
  assert.equal(sql("select count(*) from pg_tables where schemaname='public';"), '0', 'Partial/unknown schema: do not retry blindly');
  for (const file of current) {
    const payload = readFileSync(path.join(root, 'supabase/migrations', file.name), 'utf8');
    let preflight = '';
    if (file.name === '20261014140000_order_write_boundary.sql') {
      verifyContainers();
      // A brand-new private stack has no deployed apps, customers or legacy writers.
      assert.equal(sql(`select (select count(*) from auth.users)+(select count(*) from public.orders)+(select count(*) from public.order_submissions)+(select count(*) from public.workflow_inbound_queue)+(select count(*) from public.integrations);`), '0');
      const acl = sql(readFileSync(path.join(root, 'supabase/operations/order_write_boundary_snapshot.sql'), 'utf8'));
      writeFileSync(path.join(work, 'w0b-local-acl.json'), acl, { mode: 0o600 });
      // Prove the existing guard refuses an unreviewed attempt, without changes.
      assert.throws(() => sql(payload), /w0b_dependency_review_required/);
      preflight = "set agjenti.w0b_dependencies_verified='on';\n";
    }
    try { sql(`set lock_timeout='5s'; set statement_timeout='60s';\n${preflight}${migrationSql(payload)}`); }
    catch (error) {
      writeFileSync(path.join(work, 'migration-blocker.txt'), `${file.name}\n${error.message}\n`);
      throw error;
    }
    console.log(`Applied LOCAL ${file.name}`);
  }
  writeFileSync(manifestPath, JSON.stringify(current, null, 2));
  sql("notify pgrst, 'reload schema';");
}
async function up() {
  mkdirSync(path.join(stack, 'supabase'), { recursive: true, mode: 0o700 });
  assert.ok(!existsSync(path.join(stack, 'supabase/.temp/project-ref')), 'Linked project forbidden');
  assert.match(run(cli, ['--version']), /2\.121\.0/);
  const config = readFileSync(path.join(root, 'e2e/supabase/config.toml'), 'utf8');
  assert.ok(config.includes('project_id = "agjenti-e2e-local"'));
  writeFileSync(path.join(stack, 'supabase/config.toml'), config.replace('project_id = "agjenti-e2e-local"', `project_id = "${project}"`));
  const networks = run('docker', ['network', 'ls', '--format', '{{.Name}}']).split('\n');
  if (!networks.includes(network)) run('docker', ['network', 'create', '--internal', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', '--label', `agjenti.e2e=${project}`, network]);
  verifyNetwork();
  // CLI output may contain disposable local keys: keep it private, not in logs.
  supabase(['start', '-x', 'studio,postgres-meta,logflare,vector,realtime,edge-runtime,supavisor,imgproxy']);
  verifyContainers();
  replay();
  console.log('Local Supabase ready; production credentials never loaded.');
}
async function app(syntheticR3 = false) {
  verifyContainers();
  assert.ok(existsSync(manifestPath), 'Migration replay incomplete');
  replay(); // Existing manifest must match before app startup, not merely exist.
  const keys = localKeys();
  const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
  const dir = mkdtempSync(path.join(work, 'app-'));
  // Copy current source, not git HEAD: uncommitted changes are tested too.
  for (const name of ['src', 'public', 'package.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs'])
    cpSync(path.join(root, name), path.join(dir, name), { recursive: true });
  assert.ok(!readdirSync(dir).some(name => name.startsWith('.env')), 'Env files forbidden in isolated app');
  if (!existsSync(path.join(dir, 'node_modules'))) symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const env = { ...safeEnv(), NEXT_PUBLIC_APP_URL: 'http://localhost:3103', NEXT_PUBLIC_SUPABASE_URL: keys.api,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anon, SUPABASE_SERVICE_ROLE_KEY: keys.service,
    TOKEN_ENCRYPTION_KEY: fixtures.encryptionKey, OPENAI_API_KEY: '',
    MODULE_ENFORCEMENT_BUSINESS_IDS: fixtures.tenants.map(t => t.id).join(','),
    SHARED_WORKFLOW_BUSINESS_IDS: fixtures.tenants.map(t => t.id).join(','),
    NODE_OPTIONS: `--require=${path.join(root, 'e2e/network-guard.cjs')}` };
  // Dedicated controlled-provider command only. Never load a real API key or
  // grant external egress. Ordinary `app` retains its provider-denied behavior.
  if (syntheticR3) {
    assert.equal(project, 'agjenti-e2e-local-recovery-3a-20261023');
    env.OPENAI_API_KEY = 'synthetic-r3-local-only';
    env.OPENAI_BASE_URL = 'http://127.0.0.1:55325/v1';
    env.E2E_R3_PROVIDER = 'synthetic';
  }
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3103'], { cwd: dir, env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  await new Promise(resolve => child.on('exit', code => { process.exitCode = code ?? 1; resolve(); }));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === 'up') await up();
    else if (command === 'app') await app();
    else if (command === 'app-r3') await app(true);
    else if (command === 'down') { verifyNetwork(); supabase(['stop', '--project-id', project]); console.log('Local stack stopped; data retained.'); }
    else if (command === 'status') { verifyContainers(); console.log('Local dependencies isolated and available.'); }
    else throw new Error('Use up | app | status | down');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
