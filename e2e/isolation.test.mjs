import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { safeEnv, root, migrationSql } from './local.mjs';
import path from 'node:path';

test('application environment does not inherit cloud/provider credentials or proxies', () => {
  const env = safeEnv();
  for (const key of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'META_APP_SECRET', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'NODE_OPTIONS', 'HTTP_PROXY'])
    assert.equal(env[key], undefined);
});
test('migration replay supplies atomicity without replacing existing transactions or guards', () => {
  const statement = 'create temporary table t(x int) on commit drop; insert into t values(1);';
  assert.equal(migrationSql(statement), `begin;\n${statement}\ncommit;`);
  const owned = '-- security guard\n\nbegin;\nselect 1;\ncommit;';
  assert.equal(migrationSql(owned), owned);
});
for (const [name, code, error] of [
  ['external fetch', "fetch('https://example.invalid')", 'E2E_PROTOCOL_BLOCKED'],
  ['external HTTP', "fetch('http://example.invalid')", 'E2E_OUTBOUND_BLOCKED'],
  ['other local database', "require('net').connect(5432,'127.0.0.1')", 'E2E_OUTBOUND_BLOCKED'],
  ['external socket', "require('net').connect(443,'192.0.2.1')", 'E2E_OUTBOUND_BLOCKED'],
  ['Unix socket', "require('net').connect({path:'/tmp/.s.PGSQL.5432'})", 'E2E_UNIX_SOCKET_BLOCKED'],
  ['TLS', "require('tls').connect(443,'example.invalid')", 'E2E_TLS_BLOCKED'],
  ['UDP', "require('dgram').createSocket('udp4')", 'E2E_UDP_BLOCKED'],
]) test(`blocks ${name} before any network operation`, () => {
  const result = spawnSync(process.execPath, ['--require', path.join(root, 'e2e/network-guard.cjs'), '-e', code], { encoding: 'utf8', env: safeEnv() });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(error));
});
