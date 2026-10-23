"""Disposable, socket-only PostgreSQL transport regressions. No external DB URL.

--baseline reproduces the pre-Package-1 defects; normal mode checks the fix.
Uses real repository migrations and independent psql sessions, not mocked SQL.
"""
import argparse
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--pg-bin', required=True)
parser.add_argument('--baseline', action='store_true')
parser.add_argument('--extra-sql', type=Path, help='Additional regression SQL, only in this fresh socket-only cluster')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
pg = Path(args.pg_bin)
work = Path(tempfile.mkdtemp(prefix='agjenti-transport-pg-'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
workers = []


def run(command, input=None, error=None):
    r = subprocess.run(command, input=input, text=True, capture_output=True, env=env, timeout=60)
    if error:
        assert r.returncode and error in r.stderr, r.stderr
    elif r.returncode:
        raise RuntimeError(r.stderr[-4000:] + r.stdout[-1000:])
    return r.stdout.strip()


run([str(pg/'initdb'), '-D', str(work/'data'), '-A', 'trust', '--encoding=UTF8', '--locale=C'])
started = False
try:
    run([str(pg/'pg_ctl'), '-D', str(work/'data'), '-l', str(work/'postgres.log'), '-o', f"-k {work} -p 55447 -h ''", 'start'])
    started = True
    cmd = [str(pg/'psql'), '-h', str(work), '-p', '55447', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']

    def sql(statement, error=None):
        return run(cmd + ['-c', statement], error=error)

    def worker(statement):
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        workers.append(p)
        p.stdin.write(statement + '\n')
        p.stdin.flush()
        return p

    def line(p):
        assert select.select([p.stdout], [], [], 10)[0], 'Worker timeout'
        return p.stdout.readline().strip()

    def finish(p):
        p.stdin.write('commit;\n')
        p.stdin.close()
        assert p.wait(timeout=10) == 0, p.stderr.read()

    assert sql('select inet_server_addr() is null') == 't'
    sql("""create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      alter default privileges in schema public grant all on tables to service_role;
      alter default privileges in schema public grant select on tables to authenticated;""")
    migrations = sorted((root/'supabase/migrations').glob('*.sql'))
    applied = 0
    for file in migrations:
        if args.baseline and file.name.endswith('_conversation_transport_reliability.sql'):
            continue
        payload = file.read_text()
        preface = ''
        if file.name == '20261014140000_order_write_boundary.sql':
            assert sql('select (select count(*) from public.orders)+(select count(*) from public.order_submissions)+(select count(*) from public.workflow_inbound_queue)') == '0'
            run(cmd + ['-f', str(file)], error='w0b_dependency_review_required')
            preface = "set agjenti.w0b_dependencies_verified='on';\n"
        # Preserve original transaction wrappers and TEMP ON COMMIT behavior.
        import re
        stripped = re.sub(r'^\s*--[^\n]*$', '', payload, flags=re.M).lstrip()
        wrapped = payload if re.match(r'begin\s*;', stripped, re.I) else 'begin;\n' + payload + '\ncommit;'
        run(cmd, input=preface + wrapped)
        applied += 1
    print(f'PASS fresh migration chain ({applied} files), PostgreSQL {sql("show server_version")}, Unix socket only: {work}', flush=True)
    if args.extra_sql:
        print(run(cmd + ['-f', str(args.extra_sql.resolve())]), flush=True)

    # Fixed IDs live only in this freshly initialized private cluster.
    b, actor, conn, c, other = [f'00000000-0000-4000-8000-{n:012d}' for n in range(9101, 9106)]
    sql(f"""insert into auth.users(id,email) values('{actor}','transport@test.invalid');
      insert into businesses(id,name,slug,auto_reply) values('{b}','Transport synthetic','transport-test',true);
      insert into business_users(business_id,user_id,role) values('{b}','{actor}','owner');
      insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values('{conn}','{b}','transport-test','synthetic','connected');
      insert into conversations(id,business_id,instagram_participant_id,instagram_connection_id,channel,status,auto_reply)
        values('{c}','{b}','person','{conn}','instagram','paused',false);
      insert into conversation_states(conversation_id,business_id,collected,revision)
        values('{c}','{b}','{{"staffHandoff":true,"fields":{{"size":"M"}},"visual":{{"versionId":"pinned-A","status":"collecting"}}}}',0);""")
    def make_job(name, conversation=None):
        assigned = f"'{conversation}'" if conversation else 'null'
        return json.loads(sql(f"""insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel,status,lease_token,leased_until,conversation_id)
          values('{b}','{conn}','person','{name}','{{}}','instagram','processing',gen_random_uuid(),now()+interval '2 minutes',{assigned}) returning json_build_object('id',id,'token',lease_token)"""))

    def call_resume(revision):
        return f"select public.resume_conversation_agent('{b}','{actor}','{c}',{revision});"

    if args.extra_sql and not args.baseline:
        policy_business = '00000000-0000-4000-8000-000000009195'
        sql(f"insert into businesses(id,name,slug) values('{policy_business}','Policy concurrency synthetic','policy-concurrent'); insert into business_users(business_id,user_id,role) values('{policy_business}','{actor}','owner')")
        policy_call = f"select public.save_agent_collection_policy('{policy_business}','{actor}',0,'[]');"
        first = worker('begin; set local role service_role; ' + policy_call)
        assert line(first) == '1'
        second = subprocess.Popen(cmd + ['-c', "set application_name='collection-stale-writer'; set role service_role; " + policy_call], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        workers.append(second)
        deadline = time.monotonic() + 5
        while sql("select count(*) from pg_stat_activity where application_name='collection-stale-writer' and wait_event_type='Lock'") != '1':
            assert time.monotonic() < deadline, 'Policy writer did not contend on row lock'
            time.sleep(.02)
        finish(first)
        _, error = second.communicate(timeout=10)
        assert second.returncode and 'stale_collection_policy' in error, error
        assert sql(f"select agent_collection_policy->>'revision' from businesses where id='{policy_business}'") == '1'
        print('PASS collection configuration: concurrent server writers serialize, stale CAS rejects without overwrite', flush=True)

    def snapshot():
        return sql(f"select json_build_array((select row_to_json(t) from conversations t where id='{c}'),(select row_to_json(t) from conversation_states t where conversation_id='{c}'),(select json_agg(t order by id) from workflow_inbound_queue t where business_id='{b}'))")

    if args.baseline:
        # Exact old route order, with a DB error in its unchecked second write.
        sql("create function public.transport_fail() returns trigger language plpgsql as $$ begin raise exception 'injected_state_failure'; end $$; create trigger transport_fail before update on public.conversation_states for each row execute function public.transport_fail();")
        sql(f"update conversations set status='active',auto_reply=true where id='{c}'")
        sql(f"update conversation_states set collected='{{}}' where conversation_id='{c}'", error='injected_state_failure')
        assert sql(f"select status='active' and auto_reply from conversations where id='{c}'") == 't'
        sql('drop trigger transport_fail on public.conversation_states; drop function public.transport_fail()')
        print('REPRODUCED A: failed state write leaves partially resumed conversation', flush=True)
        # Staff reads revision 0; worker independently commits revision 1; old
        # endpoint overwrites that newer state without a revision predicate.
        staff = worker(f"begin; select collected from conversation_states where conversation_id='{c}';")
        old = json.loads(line(staff))
        sql(f"update conversation_states set collected=jsonb_set(collected,'{{fields,size}}','\"L\"'),revision=revision+1 where conversation_id='{c}'")
        staff.stdin.write(f"update conversation_states set collected='{json.dumps(old)}' where conversation_id='{c}';\n")
        staff.stdin.flush()
        finish(staff)
        assert sql(f"select collected#>>'{{fields,size}}' from conversation_states where conversation_id='{c}'") == 'M'
        print('REPRODUCED B: independent staff session overwrites newer worker facts', flush=True)
        run(cmd + ['-f', str(root/'docs/qa-audit/tests/workflow-exhaustion.sql')], error='exhausted processing dropped a persisted customer message')
        print('REPRODUCED C: persisted inbound exhausted without conversation association/pause', flush=True)
    else:
        j = make_job('atomic')
        bind = f"select public.bind_workflow_inbound({j['id']},'{j['token']}','{c}');"
        assert sql('set role service_role; ' + bind) == 't'
        assert sql(f"select conversation_id from workflow_inbound_queue where id={j['id']}") == c
        # Existing server-only access; no newly exposed client RPCs or unsafe path.
        for fn in ['public.bind_workflow_inbound(bigint,uuid,uuid)', 'public.resume_conversation_agent(uuid,uuid,uuid,integer)']:
            assert sql(f"select has_function_privilege('service_role','{fn}','execute') and not has_function_privilege('anon','{fn}','execute') and not has_function_privilege('authenticated','{fn}','execute')") == 't'
            assert sql(f"select prosecdef and proconfig @> array['search_path=pg_catalog, pg_temp'] from pg_proc where oid='{fn}'::regprocedure") == 't'
        for fn in ['public.workflow_inbound_original_conversation(public.workflow_inbound_queue)', 'public.protect_workflow_conversation_binding()', 'public.pause_exhausted_workflow_conversation()']:
            for role in ['anon', 'authenticated', 'service_role']:
                assert sql(f"select has_function_privilege('{role}','{fn}','execute')") == 'f'
        sql('set role authenticated; update public.workflow_inbound_queue set conversation_id=null', error='permission denied')
        sql('set role authenticated; ' + call_resume(0), error='permission denied')
        stranger = '00000000-0000-4000-8000-000000009199'
        sql(call_resume(0).replace(actor, stranger), error='unauthorized')
        sql(f"delete from business_users where business_id='{b}' and user_id='{actor}'")
        sql(call_resume(0), error='unauthorized')
        sql(f"insert into business_users(business_id,user_id,role) values('{b}','{actor}','owner')")
        foreign = '00000000-0000-4000-8000-000000009198'
        sql(f"insert into businesses(id,name,slug) values('{foreign}','Other synthetic','other-transport'); insert into business_users(business_id,user_id,role) values('{foreign}','{actor}','owner')")
        sql(call_resume(0).replace(b, foreign), error='invalid_conversation')
        foreign_conn, foreign_conversation = '00000000-0000-4000-8000-000000009197', '00000000-0000-4000-8000-000000009196'
        sql(f"insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values('{foreign_conn}','{foreign}','foreign-account','synthetic','connected'); insert into conversations(id,business_id,instagram_connection_id,instagram_participant_id,channel) values('{foreign_conversation}','{foreign}','{foreign_conn}','person','instagram')")
        sql(bind.replace(c, foreign_conversation), error='conversation_binding_conflict')
        print('PASS server-only grants, restricted search_path, revoked membership and cross-tenant rejection', flush=True)

        # Inject real PostgreSQL failures at each formerly independent write.
        for table in ['conversation_states', 'workflow_inbound_queue', 'conversations']:
            before = snapshot()
            sql(f"create function public.transport_fail() returns trigger language plpgsql as $$ begin raise exception 'injected_failure'; end $$; create trigger transport_fail before update on public.{table} for each row execute function public.transport_fail();")
            sql('set role service_role; ' + call_resume(0), error='injected_failure')
            assert snapshot() == before, f'Partial commit after {table} failure'
            sql(f'drop trigger transport_fail on public.{table}; drop function public.transport_fail()')
        for table, error in [('conversation_states', 'stale_state'), ('workflow_inbound_queue', 'queue_transition_conflict'), ('conversations', 'invalid_conversation')]:
            before = snapshot()
            sql(f"create function public.transport_skip() returns trigger language plpgsql as $$ begin return null; end $$; create trigger transport_skip before update on public.{table} for each row execute function public.transport_skip();")
            sql(call_resume(0), error=error)
            assert snapshot() == before, f'Zero-row update reported success: {table}'
            sql(f'drop trigger transport_skip on public.{table}; drop function public.transport_skip()')
        sql(f"begin; delete from conversation_states where conversation_id='{c}'; {call_resume(0)}", error='state_missing')
        print('PASS A: state/queue/conversation failures roll back the complete resume', flush=True)

        assert sql('set role service_role; ' + call_resume(0)) == '1'
        assert sql(f"select collected#>>'{{fields,size}}' from conversation_states where conversation_id='{c}'") == 'M'
        assert sql(f"select collected#>>'{{visual,versionId}}' from conversation_states where conversation_id='{c}'") == 'pinned-A'
        assert sql(f"select status from workflow_inbound_queue where id={j['id']}") == 'ignored'
        sql(call_resume(0), error='stale_state')
        sql(f"select prepare_workflow_reply({j['id']},'{j['token']}','{c}',0,'{{}}',null,'stale',null,false)", error='lease_lost')
        assert sql(f"select begin_workflow_send({j['id']},'{j['token']}')") == 'f'
        print('PASS valid atomic resume, pin/facts retained, stale revision and revoked worker rejected', flush=True)

        # Two actual sessions: worker holds queue+state locks and a corrected value.
        j = make_job('concurrent', c)
        prepare = f"select prepare_workflow_reply({j['id']},'{j['token']}','{c}',1,'{{\"fields\":{{\"size\":\"L\"}},\"visual\":{{\"versionId\":\"pinned-A\"}}}}',null,'new',null,false);"
        w = worker('begin; do $$ begin ' + prepare.replace('select prepare_workflow_reply', 'perform prepare_workflow_reply') + " end $$; select 'worker-locked';")
        assert line(w) == 'worker-locked'
        sql(call_resume(1), error='could not obtain lock')
        finish(w)
        sql(call_resume(1), error='stale_state')
        assert sql('set role service_role; ' + call_resume(2)) == '3'
        assert sql(f"select collected#>>'{{fields,size}}' from conversation_states where conversation_id='{c}'") == 'L'
        # Resume wins instead: a stale worker can never commit its old snapshot.
        j = make_job('resume-wins', c)
        w = worker('begin; ' + call_resume(3))
        assert line(w) == '4'
        pending = subprocess.Popen(cmd + ['-c', f"set application_name='transport-stale-worker'; select prepare_workflow_reply({j['id']},'{j['token']}','{c}',3,'{{}}',null,'stale',null,false)"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        workers.append(pending)
        deadline = time.monotonic() + 5
        while sql("select count(*) from pg_stat_activity where application_name='transport-stale-worker' and wait_event_type='Lock'") != '1':
            assert time.monotonic() < deadline, 'Worker did not contend on actual row lock'
            time.sleep(.02)
        finish(w)
        _, err = pending.communicate(timeout=10)
        assert pending.returncode and 'lease_lost' in err, err
        print('PASS B: both concurrent orderings, real lock contention, stale workers cannot overwrite', flush=True)

        # Binding is tenant/lease scoped, idempotent, and never switches thread.
        j = make_job('binding')
        bind = f"select bind_workflow_inbound({j['id']},'{j['token']}','{c}')"
        sql(bind.replace(j['token'], stranger), error='lease_lost')
        sql(bind.replace(c, foreign), error='invalid_conversation')
        assert sql(bind) == 't'
        assert sql(bind) == 't'
        sql(f"update workflow_inbound_queue set leased_until=now()-interval '1 second',attempts=3 where id={j['id']}")
        sql('select count(*) from claim_workflow_inbound_batch(null)')
        assert sql(f"select status from conversations where id='{c}'") == 'paused'
        assert sql(f"select conversation_id from workflow_inbound_queue where id={j['id']}") == c
        run(cmd + ['-f', str(root/'docs/qa-audit/tests/workflow-exhaustion.sql')])
        print('PASS C: early binding and exact-receipt recovery of historical unbound exhaustion', flush=True)

        # Unknown outcomes retain the original lease, receipt and reply. No resend.
        sql(f"update conversations set status='active',auto_reply=true where id='{c}'")
        j = make_job('receipt', c)
        sql(f"select prepare_workflow_reply({j['id']},'{j['token']}','{c}',4,'{{\"fields\":{{\"size\":\"L\"}}}}',null,'receipt reply',null,false)")
        assert sql(f"select begin_workflow_send({j['id']},'{j['token']}')") == 't'
        before = snapshot()
        sql(call_resume(5), error='delivery_unverified')
        assert before == snapshot()
        sql(f"select finish_workflow_send({j['id']},'{j['token']}',false,null,'timeout')")
        before = snapshot()
        sql(call_resume(5), error='delivery_unverified')
        assert before == snapshot()
        assert sql(f"select begin_workflow_send({j['id']},'{j['token']}')") == 'f'
        receipt = f"select finish_workflow_send({j['id']},'{j['token']}',true,'transport-receipt',null)"
        sql(receipt)
        sql(receipt)
        assert sql("select count(*) from messages where external_message_id='transport-receipt'") == '1'
        assert sql(call_resume(5)) == '6'
        print('PASS lost receipt/replay: no duplicate send claim; resume preserves uncertain evidence until reconciliation', flush=True)
        # Keep the existing handoff-reset semantics while retaining every saved
        # workflow pin and process-owned fact. This check itself rolls back.
        before = snapshot()
        state = {"staffHandoff": True, "conversationPaused": True, "fields": {"size": "L"},
                 "visual": {"versionId": "pinned-A", "status": "handoff", "advisory": False},
                 "processes": {"active": "order", "promptOwner": "order", "pendingChoice": {}, "auxiliary": {},
                               "order": {"snapshot": {"visual": {"versionId": "pinned-A"}, "fields": {"size": "L"}}}}}
        expected = json.loads(json.dumps(state))
        del expected['staffHandoff']
        expected['conversationPaused'] = False
        expected['completedVisual'] = dict(expected['visual'])
        expected['visual']['status'] = 'completed'
        expected['processes'].update(active=None, promptOwner=None)
        del expected['processes']['pendingChoice'], expected['processes']['auxiliary']
        output = sql(f"begin; update conversation_states set collected='{json.dumps(state)}' where conversation_id='{c}'; {call_resume(6)} select collected from conversation_states where conversation_id='{c}'; rollback;").splitlines()
        assert output[0] == '7' and json.loads(output[1]) == expected
        assert snapshot() == before
        print('PASS handoff reset preserves suspended process snapshots, fields and pinned A', flush=True)

    # Same participant, DIFFERENT conversation: authoritative receipt is the only
    # recovery link. Old completed thread must never pause the new active thread.
    sql(f"update conversations set status='completed' where id='{c}'; insert into conversations(id,business_id,instagram_participant_id,instagram_connection_id,channel,status,auto_reply) values('{other}','{b}','person','{conn}','instagram','active',true);")
    j = make_job('old-exhausted')
    sql(f"insert into messages(business_id,conversation_id,instagram_connection_id,direction,source,external_message_id,body,delivery_status) values('{b}','{c}','{conn}','inbound','customer','old-exhausted','synthetic','delivered'); update workflow_inbound_queue set attempts=3,leased_until=now()-interval '1 second' where id={j['id']};")
    sql('select count(*) from claim_workflow_inbound_batch(null)')
    assert sql(f"select status='active' and auto_reply from conversations where id='{other}'") == 't'
    sql(f"insert into conversation_states(conversation_id,business_id) values('{other}','{b}')")
    if args.baseline:
        # Even an already associated job can be rebound by the previous prepare
        # RPC to a newer thread with the same participant/connection.
        sql(f"update workflow_inbound_queue set status='processing',conversation_id='{c}',leased_until=now()+interval '1 minute' where id={j['id']}")
        sql(f"select prepare_workflow_reply({j['id']},'{j['token']}','{other}',0,'{{\"fields\":{{\"old\":\"leaked\"}}}}',null,'old reply',null,false)")
        assert sql(f"select collected#>>'{{fields,old}}' from conversation_states where conversation_id='{other}'") == 'leaked'
        print('REPRODUCED D boundary: old prepare RPC rebinds an associated job to a newer same-participant thread', flush=True)
    if not args.baseline:
        assert sql(f"select conversation_id from workflow_inbound_queue where id={j['id']}") == c
        sql(f"update workflow_inbound_queue set status='processing',leased_until=now()+interval '1 minute' where id={j['id']}")
        sql(f"select bind_workflow_inbound({j['id']},'{j['token']}','{other}')", error='conversation_binding_conflict')
        sql(f"select prepare_workflow_reply({j['id']},'{j['token']}','{other}',0,'{{\"fields\":{{\"old\":\"leaked\"}}}}',null,'old reply',null,false)", error='conversation_binding_conflict')
        assert sql(f"select revision from conversation_states where conversation_id='{other}'") == '0'
        sql(f"update workflow_inbound_queue set status='failed' where id={j['id']}")
        unbound = make_job('no-proof')
        sql(f"update workflow_inbound_queue set attempts=3,leased_until=now()-interval '1 second' where id={unbound['id']}")
        sql('select count(*) from claim_workflow_inbound_batch(null)')
        assert sql(f"select status='failed' and conversation_id is null and error like '%staff review required%' from workflow_inbound_queue where id={unbound['id']}") == 't'
        assert sql(f"select status='active' and auto_reply from conversations where id='{other}'") == 't'
    if not args.baseline:
        print('PASS D: old/unknown jobs never change newer same-participant conversation (claim, bind and prepare)', flush=True)

        # Duplicate insert and independent competing claimers use actual unique
        # constraints/locks. A crash/reclaim rotates the lease, never the identity.
        first, second = make_job('queue-first'), make_job('queue-second')
        sql(f"update workflow_inbound_queue set status='queued',attempts=0,leased_until=null where id in ({first['id']},{second['id']})")
        sql(f"insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel) values('{b}','{conn}','person','queue-first','{{}}','instagram') on conflict(connection_id,external_id) do nothing")
        assert sql("select count(*) from workflow_inbound_queue where external_id='queue-first'") == '1'
        w = worker("begin; select external_id from claim_workflow_inbound(null);")
        assert line(w) == 'queue-first'
        assert sql('select count(*) from claim_workflow_inbound(null)') == '0'
        finish(w)
        assert sql('select count(*) from claim_workflow_inbound(null)') == '0'
        old_token = sql(f"select lease_token from workflow_inbound_queue where id={first['id']}")
        sql(f"select bind_workflow_inbound({first['id']},'{old_token}','{other}'); update workflow_inbound_queue set leased_until=now()-interval '1 second' where id={first['id']}")
        new_token = sql('select lease_token from claim_workflow_inbound(null)')
        assert new_token != old_token
        sql(f"select bind_workflow_inbound({first['id']},'{old_token}','{other}')", error='lease_lost')
        assert sql(f"select conversation_id from workflow_inbound_queue where id={first['id']}") == other
        sql(f"update workflow_inbound_queue set status='ignored',leased_until=null where id in ({first['id']},{second['id']})")
        print('PASS duplicate inbound, concurrent claims, restart/lease rotation and preserved original identity', flush=True)

    # Existing transport/state contracts, with all fixture writes rolled back.
    if not args.baseline:
        for name in ['shared_workflow_context.sql', 'workflow_message_runtime.sql', 'instagram_message_batches.sql', 'workflow_staff_handoff.sql', 'workflow_delivery_receipts.sql', 'business_billing.sql']:
            run(cmd + ['-f', str(root/'supabase/tests'/name)])
            print('PASS existing ' + name, flush=True)
finally:
    for p in workers:
        if p.poll() is None:
            p.terminate()
            p.wait(timeout=10)
    if started:
        run([str(pg/'pg_ctl'), '-D', str(work/'data'), '-m', 'fast', 'stop'])
    print(f'Isolated cluster stopped; evidence retained at {work}', flush=True)
