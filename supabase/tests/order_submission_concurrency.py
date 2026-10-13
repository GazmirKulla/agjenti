"""W4 real row-lock test. Requires an ALREADY migrated, disposable *_w4_test DB.

No migrations are applied. Never run against production. Fixtures are committed
because the two workers must see them; cleanup is limited to their random IDs.
"""
import argparse
import json
import select
import subprocess
import uuid
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--database-url", required=True)
parser.add_argument("--psql", default="psql")
args = parser.parse_args()
if not urlparse(args.database_url).path.endswith("_w4_test"):
    parser.error("Use a disposable database whose name ends with _w4_test")
cmd = [args.psql, args.database_url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]


def sql(statement):
    result = subprocess.run(cmd + ["-c", statement], capture_output=True, text=True, timeout=15)
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    return result.stdout.strip()


b, actor, c, product, review = [str(uuid.uuid4()) for _ in range(5)]
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
call = f"select submit_confirmed_order('{b}','{actor}','{c}',7,'{encoded}','{encoded}',false);"
workers = []
try:
    sql(f"""
      insert into auth.users(id,email) values('{actor}','{actor}@test.invalid');
      insert into businesses(id,name,slug,dashboard_profile) values('{b}','W4 concurrency','w4-{b}',
        '{{"source":"manual","version":1,"enabledModules":["products","orders"]}}');
      insert into business_users(business_id,user_id,role) values('{b}','{actor}','owner');
      insert into products(id,business_id,name,price_amount,currency) values('{product}','{b}','Test',10,'USD');
      insert into conversations(id,business_id) values('{c}','{b}');
      insert into conversation_states(conversation_id,business_id,collected,revision) values('{c}','{b}','{encoded}',7);
    """)
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
