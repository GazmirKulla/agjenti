import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { safeEnv, root, migrationSql } from './local.mjs';
import path from 'node:path';

test('application environment does not inherit cloud/provider credentials or proxies', () => {
  const env = safeEnv();
  for (const key of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'E2E_R3_PROVIDER', 'META_APP_SECRET', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'NODE_OPTIONS', 'HTTP_PROXY'])
    assert.equal(env[key], undefined);
});
test('migration replay supplies atomicity without replacing existing transactions or guards', () => {
  const statement = 'create temporary table t(x int) on commit drop; insert into t values(1);';
  assert.equal(migrationSql(statement), `begin;\n${statement}\ncommit;`);
  const owned = '-- security guard\n\nbegin;\nselect 1;\ncommit;';
  assert.equal(migrationSql(owned), owned);
});
test('fresh instance isolates resources and rejects unsafe identifiers', () => {
  const inspect = "import('./e2e/local.mjs').then(m=>console.log(JSON.stringify([m.work,m.project,m.network])))";
  const result = spawnSync(process.execPath, ['-e', inspect], { cwd: root, env: { ...safeEnv(), E2E_INSTANCE: 'recovery-test' }, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), [path.join(root, '.e2e-local/instances/recovery-test'), 'agjenti-e2e-local-recovery-test', 'agjenti_e2e_isolated_recovery-test']);
  const invalid = spawnSync(process.execPath, ['-e', inspect], { cwd: root, env: { ...safeEnv(), E2E_INSTANCE: '../default' }, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
});
for (const [name, code, error] of [
  ['external fetch', "fetch('https://example.invalid')", 'E2E_PROTOCOL_BLOCKED'],
  ['external HTTP', "fetch('http://example.invalid')", 'E2E_OUTBOUND_BLOCKED'],
  ['other local database', "require('net').connect(5432,'127.0.0.1')", 'E2E_OUTBOUND_BLOCKED'],
  ['synthetic provider without dedicated opt-in', "require('net').connect(55325,'127.0.0.1')", 'E2E_OUTBOUND_BLOCKED'],
  ['external socket', "require('net').connect(443,'192.0.2.1')", 'E2E_OUTBOUND_BLOCKED'],
  ['Unix socket', "require('net').connect({path:'/tmp/.s.PGSQL.5432'})", 'E2E_UNIX_SOCKET_BLOCKED'],
  ['TLS', "require('tls').connect(443,'example.invalid')", 'E2E_TLS_BLOCKED'],
  ['UDP', "require('dgram').createSocket('udp4')", 'E2E_UDP_BLOCKED'],
]) test(`blocks ${name} before any network operation`, () => {
  const result = spawnSync(process.execPath, ['--require', path.join(root, 'e2e/network-guard.cjs'), '-e', code], { encoding: 'utf8', env: safeEnv() });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(error));
});
test('synthetic provider opt-in still blocks external fetch and TLS',()=>{
  for(const code of ["fetch('https://api.openai.com/v1/responses')","require('tls').connect(443,'example.invalid')","require('net').connect(443,'192.0.2.1')"]){
    const result=spawnSync(process.execPath,['--require',path.join(root,'e2e/network-guard.cjs'),'-e',code],{encoding:'utf8',env:{...safeEnv(),E2E_R3_PROVIDER:'synthetic'}});
    assert.notEqual(result.status,0);assert.match(result.stderr,/E2E_(?:PROTOCOL|TLS|OUTBOUND)_BLOCKED/);
  }
});
