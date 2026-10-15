"""W4 real row-lock test. Requires an ALREADY migrated, disposable *_w4_test DB.

No migrations are applied. Never run against production. Fixtures are committed
because the two workers must see them; cleanup is limited to their random IDs.
"""
import argparse
import json
from pathlib import Path
import select
import subprocess
import time
import uuid
from urllib.parse import parse_qs, urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--database-url", required=True)
parser.add_argument("--psql", default="psql")
args = parser.parse_args()
url = urlparse(args.database_url)
query = parse_qs(url.query)
host = url.hostname or query.get("host", [""])[0]
if not url.path.endswith("_w4_test") or not host.startswith("/") or "hostaddr" in query:
    parser.error("Use a disposable *_w4_test database through an explicit local Unix socket")
cmd = [args.psql, args.database_url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]


def sql(statement, fixture=False):
    helpers = ["-f", str(Path(__file__).parent / "fixtures/order_readiness.sql")] if fixture else []
    result = subprocess.run(cmd + helpers + ["-c", statement], capture_output=True, text=True, timeout=15)
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    return result.stdout.strip()


b, actor, c, product, review = [str(uuid.uuid4()) for _ in range(5)]
assert sql("select inet_server_addr() is null") == "t"
state = {
    "schemaVersion": 3, "product_id": product, "product_type_id": None,
    "step_key": "order_ready", "fields": {},
    "customer": {"name": "Test", "phone": "+355691234567", "address": "Test only"},
    "context": {"execution": {
        "factOwner": "order", "orderConfirmed": True,
        "orderTerms": {"productId": product, "unitAmount": 10, "currency": "USD", "quantity": 1},
        "orderReview": {"id": review, "confirmed": True, "fieldKeys": [], "factsKey": "test-facts", "expiresAt": 4102444800000},
    }},
}
encoded = json.dumps(state)
workers = []
try:
    encoded = sql(f"""
      insert into auth.users(id,email) values('{actor}','{actor}@test.invalid');
      insert into businesses(id,name,slug,dashboard_profile) values('{b}','W4 concurrency','w4-{b}',
        '{{"source":"manual","version":1,"enabledModules":["products","orders","workflows"]}}');
      insert into business_users(business_id,user_id,role) values('{b}','{actor}','owner');
      insert into products(id,business_id,name,price_amount,currency) values('{product}','{b}','Test',10,'USD');
      insert into conversations(id,business_id) values('{c}','{b}');
      select pg_temp.pin_test_order('{b}','{actor}','{encoded}');
    """, fixture=True)
    sql(f"insert into conversation_states(conversation_id,business_id,collected,revision) values('{c}','{b}','{encoded}',7);")
    call = f"set role service_role; select public.submit_confirmed_order('{b}','{actor}','{c}',7,'{encoded}','{encoded}',false);"
    # A concurrent deactivation wins before the readiness lock. Submission must
    # observe the committed revocation and cannot persist or authorize dispatch.
    for target, revoke, restore, expected in [
        ("product", f"update public.products set is_active=false where id='{product}'",
         f"update public.products set is_active=true where id='{product}'", "product_unavailable"),
        ("workflow", f"select public.save_visual_workflow('{b}','{actor}',1,null,'disable')",
         f"select public.save_visual_workflow('{b}','{actor}',2,null,'enable')", "workflow_not_ready"),
        ("module", f"select public.save_business_modules('{b}','{actor}','{{\"version\":1,\"source\":\"manual\",\"enabledModules\":[\"products\",\"workflows\"]}}')",
         f"select public.save_business_modules('{b}','{actor}','{{\"version\":1,\"source\":\"manual\",\"enabledModules\":[\"products\",\"orders\",\"workflows\"]}}')", "module_disabled"),
    ]:
        revoker = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, bufsize=1)
        workers.append(revoker)
        revoker.stdin.write(f"begin;\n{revoke};\nselect 'locked';\n")
        revoker.stdin.flush()
        assert select.select([revoker.stdout], [], [], 10)[0], "Revoker did not acquire lock"
        line = revoker.stdout.readline().strip()
        if line != "locked":
            # An RPC may emit its revision/void result before the marker.
            assert revoker.stdout.readline().strip() == "locked"
        app_name = f"readiness-{target}-{b}"
        denied = subprocess.Popen(cmd + ["-c", f"set application_name='{app_name}'; {call}"],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        workers.append(denied)
        deadline = time.monotonic() + 10
        while sql(f"select count(*) from pg_stat_activity where application_name='{app_name}' and wait_event_type='Lock'") != "1":
            assert time.monotonic() < deadline and denied.poll() is None, "Submission did not wait on readiness lock"
            time.sleep(0.01)
        revoker.stdin.write("commit;\n")
        revoker.stdin.close()
        assert revoker.wait(timeout=10) == 0, revoker.stderr.read()
        output, error = denied.communicate(timeout=10)
        assert denied.returncode and expected in error and '"dispatch": true' not in output, (output, error)
        assert sql(f"select count(*) from public.orders where business_id='{b}'") == "0"
        assert sql(f"select count(*) from public.order_submissions where business_id='{b}'") == "0"
        sql(restore)
        print(f"PASS concurrent {target} deactivation: real lock wait, rejection, zero orders/dispatch")
    winner = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    workers.append(winner)
    winner.stdin.write("begin;\n" + call + "\n")
    winner.stdin.flush()
    assert select.select([winner.stdout], [], [], 10)[0], "First transaction did not return"
    first = json.loads(winner.stdout.readline())
    assert first["dispatch"] is True
    # Start second caller while the first still holds conversation/state locks.
    loser = subprocess.Popen(cmd + ["-c", call], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    workers.append(loser)
    assert not select.select([loser.stdout], [], [], 0.25)[0], "Concurrent request bypassed the lock"
    winner.stdin.write("commit;\n")
    winner.stdin.close()
    assert winner.wait(timeout=10) == 0, winner.stderr.read()
    output, error = loser.communicate(timeout=10)
    assert loser.returncode == 0, error
    second = json.loads(output)
    assert first["orderId"] == second["orderId"] and second["dispatch"] is False
    assert sql(f"select count(*) from orders where business_id='{b}';") == "1"
    assert sql(f"select count(*) from order_items where order_id='{first['orderId']}';") == "1"
    assert sql(f"select count(*) from order_submissions where business_id='{b}';") == "1"
    replay = json.loads(sql(call))
    assert replay["orderId"] == first["orderId"] and replay["dispatch"] is False
    print("PASS real concurrent requests + stale-revision replay: one order, one item, one dispatch grant")
finally:
    for worker in workers:
        if worker.poll() is None:
            worker.terminate()
            worker.wait(timeout=10)
    sql(f"""
      delete from order_submissions where business_id='{b}';
      delete from orders where business_id='{b}';
      delete from businesses where id='{b}';
      delete from auth.users where id='{actor}';
    """)
