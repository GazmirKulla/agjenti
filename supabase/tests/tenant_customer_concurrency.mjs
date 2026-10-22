// Real independent PostgreSQL sessions, not Promise-only/mock concurrency.
// Requires an S1-migrated synthetic copy in agjenti_s1_w4_test. Never accepts a URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { verifyContainers, run, safeEnv, project } from '../../e2e/local.mjs';

const args = ['exec', '-i', `supabase_db_${project}`, 'psql', '-X', '-qAt', '-U', 'postgres',
  '-d', 'agjenti_s1_w4_test', '-v', 'ON_ERROR_STOP=1'];
const query = input => run('docker', args, { input });
function session(name) {
  const child = spawn('docker', args, { env: safeEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise(resolve => child.on('close', code => resolve({ code, stdout, stderr })));
  child.stdin.write(`set application_name='${name}'; set statement_timeout='20s'; \n`);
  return { child, done, output: () => stdout };
}
async function until(check) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Database did not reach the expected lock boundary');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

test.before(() => {
  verifyContainers();
  assert.equal(query("select cardinality(conkey) from pg_constraint where conrelid='public.conversations'::regclass and conname='conversations_customer_id_fkey';"), '2');
});
for (const parentFirst of [true, false]) {
  test(`S1 concurrent reparent/link: ${parentFirst ? 'parent' : 'child'} locks first`, { timeout: 60000 }, async () => {
    const a = randomUUID(), b = randomUUID(), customer = randomUUID(), conversation = randomUUID();
    const tag = randomUUID().replaceAll('-', '');
    let first, second;
    try {
      query(`insert into public.businesses(id,name,slug) values('${a}','S1 race','${a}'),('${b}','S1 race','${b}');
        insert into public.customers(id,business_id) values('${customer}','${a}');`);
      const parent = `update public.customers set business_id='${b}' where id='${customer}';`;
      const child = `insert into public.conversations(id,business_id,customer_id) values('${conversation}','${a}','${customer}');`;
      first = session(`s1_first_${tag}`);
      first.child.stdin.write(`begin; ${parentFirst ? parent : child} select 'locked';\n`);
      await until(() => first.output().includes('locked'));
      second = session(`s1_second_${tag}`);
      second.child.stdin.end(`\u005cset VERBOSITY verbose\nbegin; ${parentFirst ? child : parent} commit;\n`);
      await until(() => query(`select count(*) from pg_stat_activity where application_name='s1_second_${tag}'
        and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`) === '1');
      first.child.stdin.end('commit;\n');
      assert.equal((await first.done).code, 0);
      const rejected = await second.done;
      assert.notEqual(rejected.code, 0);
      assert.match(rejected.stderr, /23503/);
      assert.match(rejected.stderr, /conversations_customer_id_fkey/);
      assert.equal(query(`select count(*) from public.conversations c join public.customers u on u.id=c.customer_id
        where c.id='${conversation}' and c.business_id<>u.business_id;`), '0');
      assert.equal(query(`select count(*) from public.conversations where id='${conversation}';`), parentFirst ? '0' : '1');
    } finally {
      for (const s of [first, second]) if (s) {
        if (!s.child.stdin.writableEnded) s.child.stdin.end('rollback;\n');
        await s.done;
      }
      query(`delete from public.businesses where id in ('${a}','${b}');`);
    }
  });
}
