"""Package 3B SQL boundary regression; invoked only by conversation_transport.py.

Uses its freshly migrated socket-only cluster, never an external database URL.
Manual staff RPC calls intentionally create synthetic local orders. No provider
dispatch is performed. This tests SQL serialization, not LLM or browser behavior.
"""
import copy
import json
import select
import subprocess
import sys
import time
import uuid


def verify_order_correction(base_cmd, env, root):
    def run(command, statement):
        return subprocess.run(command + ['-c', statement], capture_output=True,
                              text=True, env=env, timeout=20)

    assert '-h' in base_cmd and base_cmd[base_cmd.index('-h') + 1].startswith('/')
    assert run(base_cmd, 'select inet_server_addr() is null').stdout.strip() == 't'
    created = run(base_cmd, 'create database correction_w4_test template postgres')
    assert created.returncode == 0, created.stderr
    cmd = list(base_cmd)
    cmd[cmd.index('-d') + 1] = 'correction_w4_test'
    workers = []

    def sql(statement, error=None, fixture=False):
        command = cmd + (['-f', str(root/'supabase/tests/fixtures/order_readiness.sql')] if fixture else [])
        result = run(command, statement)
        if error:
            assert result.returncode and error in result.stderr, (result.stdout, result.stderr)
        else:
            assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    def start(statement, name):
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
        workers.append(p)
        p.stdin.write(f"set application_name='{name}'; set statement_timeout='15s'; {statement}\n")
        p.stdin.flush()
        return p

    def receive(p):
        assert select.select([p.stdout], [], [], 10)[0], 'RPC did not return'
        return p.stdout.readline().strip()

    def commit(p):
        p.stdin.write('commit;\n')
        p.stdin.close()
        assert p.wait(timeout=10) == 0, p.stderr.read()

    def outcome(p, error=None):
        p.stdin.close()
        assert p.wait(timeout=20) is not None
        output, detail = p.stdout.read().strip(), p.stderr.read()
        if error:
            assert p.returncode and error in detail, (output, detail)
            assert '"dispatch": true' not in output
        else:
            assert p.returncode == 0, detail
        return output

    def fixture():
        b, actor, c, product, review, conn = [str(uuid.uuid4()) for _ in range(6)]
        state = {'schemaVersion': 3, 'product_id': product, 'product_type_id': None,
                 'step_key': 'order_ready', 'fields': {},
                 'customer': {'name': 'Synthetic', 'phone': '+355691234567', 'address': 'Test only'},
                 'context': {'execution': {'factOwner': 'order', 'orderConfirmed': True,
                     'orderTerms': {'productId': product, 'unitAmount': 10, 'currency': 'USD', 'quantity': 1},
                     'orderReview': {'id': review, 'confirmed': True, 'fieldKeys': [],
                                     'expiresAt': 4102444800000, 'factsKey': 'fixture'}}}}
        state = json.loads(sql(f"""
          insert into auth.users(id,email) values('{actor}','{actor}@test.invalid');
          insert into public.businesses(id,name,slug,auto_reply,dashboard_profile) values('{b}','Correction synthetic','{b}',true,
            '{{"source":"manual","version":1,"enabledModules":["products","orders","workflows"]}}');
          insert into public.business_users(business_id,user_id,role) values('{b}','{actor}','owner');
          insert into public.products(id,business_id,name,price_amount,currency) values('{product}','{b}','Synthetic',10,'USD');
          insert into public.instagram_connections(id,business_id,ig_user_id,access_token_ciphertext)
            values('{conn}','{b}','{conn}','synthetic-only');
          insert into public.conversations(id,business_id,instagram_connection_id,instagram_participant_id,auto_reply,status)
            values('{c}','{b}','{conn}','{c}',true,'active');
          select pg_temp.pin_test_order('{b}','{actor}','{json.dumps(state)}');
        """, fixture=True))
        # Match the eligibility invariant enforced by correctPreparedRequest:
        # completed collection-only order, current owner order, step order_ready.
        scope = {'mode': 'collection_only', 'versionId': state['visual']['versionId'],
                 'flowId': 'order', 'domain': 'order', 'profileFields': ['name', 'phone', 'address']}
        sql(f"""set role service_role;
          select public.save_visual_workflow('{b}','{actor}',1,null,'disable');
          select public.save_agent_collection_policy('{b}','{actor}',0,'{json.dumps([scope])}');
          select public.save_visual_workflow('{b}','{actor}',2,null,'enable');""")
        state['visual'].update(status='completed', collection={**scope, 'businessId': b, 'revision': 1})
        state['processes'] = {'active': None, 'order': {'id': review, 'status': 'completed'}}
        encoded = json.dumps(state)
        sql(f"insert into public.conversation_states(conversation_id,business_id,collected,revision,status) values('{c}','{b}','{encoded}',7,'ready')")
        job = json.loads(sql(f"""insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,
          conversation_id,status,lease_token,leased_until) values('{b}','{conn}','{c}','{c}','{{}}','{c}',
          'processing',gen_random_uuid(),now()+interval '10 minutes') returning json_build_object('id',id,'token',lease_token)"""))
        corrected = copy.deepcopy(state)
        corrected['customer']['phone'] = '+355699999999'
        corrected['step_key'] = 'order_confirm'
        corrected['context']['execution']['orderConfirmed'] = False
        corrected['context']['execution']['orderReview'] = {'id': str(uuid.uuid4()), 'confirmed': False}
        corrected['visual']['status'] = 'waiting'
        # The production coordinator computes this candidate before queue CAS;
        # its validator/projection are covered separately by application tests.
        correction = f"select public.prepare_workflow_reply({job['id']},'{job['token']}','{c}',7,'{json.dumps(corrected)}',null,'Corrected review',null,false); select 'corrected';"
        submit = f"select public.submit_confirmed_order('{b}','{actor}','{c}',7,'{encoded}','{encoded}',false);"
        return b, actor, c, job, state, corrected, correction, submit

    try:
        for mode in ['correction_first', 'staff_first', 'simultaneous', 'simultaneous', 'simultaneous']:
            b, actor, c, job, state, corrected, correction, submit = fixture()
            assert sql(f"select count(*) from public.order_submissions where business_id='{b}'") == '0'
            if mode != 'simultaneous':
                first_call, second_call = (correction, submit) if mode == 'correction_first' else (submit, correction)
                first = start('begin; set local role service_role; ' + first_call, 'correction-first')
                first_output = receive(first)
                if mode == 'correction_first':
                    assert first_output == ''  # prepare_workflow_reply returns void
                    assert first.stdout.readline().strip() == 'corrected'
                else:
                    assert json.loads(first_output)['dispatch'] is True
                second = start('set role service_role; ' + second_call, 'correction-waiter')
                deadline = time.monotonic() + 5
                while sql("select count(*) from pg_stat_activity where application_name='correction-waiter' and wait_event_type='Lock'") != '1':
                    assert time.monotonic() < deadline and second.poll() is None, 'No real lock contention'
                    time.sleep(.01)
                commit(first)
                outcome(second, 'stale_state')
            else:
                first = start('set role service_role; ' + correction, 'correction-simultaneous')
                second = start('set role service_role; ' + submit, 'staff-simultaneous')
                first.stdin.close(); second.stdin.close()
                first.wait(timeout=20); second.wait(timeout=20)
                assert (first.returncode == 0) != (second.returncode == 0), 'Exactly one winner required'
                loser = first if first.returncode else second
                assert 'stale_state' in loser.stderr.read()
            persisted = json.loads(sql(f"select json_build_object('revision',revision,'state',collected,'status',status) from public.conversation_states where conversation_id='{c}'"))
            assert persisted['revision'] == 8
            orders = int(sql(f"select count(*) from public.orders where business_id='{b}'"))
            if mode != 'simultaneous':
                assert orders == (0 if mode == 'correction_first' else 1)
            assert orders in [0, 1]
            if orders:
                assert persisted['state'] == state and persisted['status'] == 'submitted'
                assert sql(f"select status from public.workflow_inbound_queue where id={job['id']}") == 'processing'
                receipt = json.loads(sql('set role service_role; ' + submit))
                assert receipt['dispatch'] is False and receipt['status'] == 'pending_reconciliation'
                assert sql(f"select payload#>>'{{customer,phone}}' from public.orders where business_id='{b}'") == state['customer']['phone']
            else:
                assert persisted['state'] == corrected
                assert sql(f"select status from public.workflow_inbound_queue where id={job['id']}") == 'prepared'
                sql('set role service_role; ' + submit, 'stale_state')
                # A caller cannot revive the old approval even if it rereads the
                # current CAS revision and snapshot after losing the race.
                stale_receipt = f"select public.submit_confirmed_order('{b}','{actor}','{c}',8,'{json.dumps(corrected)}','{json.dumps(state)}',false);"
                sql('set role service_role; ' + stale_receipt, 'confirmation_required')
                sql('set role service_role; ' + correction, 'lease_lost')
            assert int(sql(f"select count(*) from public.order_submissions where business_id='{b}'")) == orders
            assert int(sql(f"select count(*) from public.order_items i join public.orders o on o.id=i.order_id where o.business_id='{b}'")) == orders
            assert int(sql(f"select count(*) from public.customers where business_id='{b}'")) == orders
            assert sql(f"select count(*) from public.bookings where business_id='{b}'") == '0'
            assert sql(f"select count(*) from public.messages where business_id='{b}'") == '0'
            assert sql(f"select count(*) from public.workflow_inbound_queue where business_id='{b}'") == '1'
            sql('set role authenticated; ' + submit, 'permission denied')
            sql('set role service_role; ' + submit.replace(actor, str(uuid.uuid4())), 'unauthorized')
            sql('set role service_role; ' + correction.replace(c, str(uuid.uuid4())), 'invalid_conversation' if orders else 'lease_lost')
            print(f'PASS {mode}: revision 7 -> 8; staff orders={orders}; losing RPC rejects; no agent transaction/provider call', flush=True)
        print('PASS 3B SQL serialization: both lock orders, 3 simultaneous races, replay, authorization and side-effect counts', flush=True)
        result = subprocess.run(cmd + ['-f', str(root/'supabase/tests/order_submission.sql')],
                                capture_output=True, text=True, env=env, timeout=60)
        assert result.returncode == 0, result.stderr
        print('PASS existing W4 SQL: atomic persistence, rollback, confirmation, tenant and privilege regressions', flush=True)
        # Existing W4 tests against the same isolated migration chain. Their own
        # random fixtures are separate from the correction evidence above.
        from urllib.parse import urlencode
        socket = cmd[cmd.index('-h') + 1]
        port = cmd[cmd.index('-p') + 1]
        url = 'postgresql:///correction_w4_test?' + urlencode({'host': socket, 'port': port})
        result = subprocess.run([sys.executable, str(root/'supabase/tests/order_submission_concurrency.py'),
                                 '--database-url', url, '--psql', cmd[0]], env=env,
                                capture_output=True, text=True, timeout=60)
        assert result.returncode == 0, result.stderr
        print(result.stdout.strip(), flush=True)
    finally:
        for p in workers:
            if p.poll() is None:
                p.terminate()
                p.wait(timeout=10)
        # Parent owns the disposable cluster and stops it; retain DB for evidence.
