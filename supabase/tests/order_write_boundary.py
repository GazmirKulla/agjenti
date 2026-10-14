"""W0-B real PostgreSQL migration/rollback tests, ONLY on a disposable local DB.

Requires W4 + W4-SEC. Models hosted grants (including column/grant-option cases),
tests refusal of unknown dependencies, and leaves this disposable DB restricted.
No network provider calls, production data or external Python dependencies.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import parse_qs, urlparse
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--database-url", required=True)
parser.add_argument("--psql", default="psql")
args = parser.parse_args()
url = urlparse(args.database_url)
query = parse_qs(url.query)
host = url.hostname or query.get("host", [""])[0]
if not url.path.endswith("_w4_test") or not host.startswith("/") or "hostaddr" in query:
    parser.error("Use a disposable *_w4_test DB through an explicit local Unix socket")
root = Path(__file__).resolve().parents[2]
cmd = [args.psql, args.database_url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]
migration = root / "supabase/migrations/20261014140000_order_write_boundary.sql"
snapshot_file = root / "supabase/operations/order_write_boundary_snapshot.sql"


def run(arguments, expected_error=None):
    result = subprocess.run(cmd + arguments, capture_output=True, text=True, timeout=30)
    if expected_error:
        assert result.returncode and expected_error in result.stderr, result.stderr
    elif result.returncode:
        raise RuntimeError(result.stderr[-3000:])
    return result.stdout.strip()


def sql(statement):
    return run(["-c", statement])


def snapshot():
    result = json.loads(run(["-f", str(snapshot_file)]))
    assert result["target_count"] == 2
    return result


def apply(expected_error=None, acknowledged=True):
    preface = ["-c", "set agjenti.w0b_dependencies_verified='on';"] if acknowledged else []
    run(preface + ["-f", str(migration)], expected_error)


def removed(grant):
    return grant["grantee"] in ("anon", "authenticated") and grant["privilege_type"] in (
        "INSERT", "UPDATE", "DELETE", "TRUNCATE")


assert sql("select inet_server_addr() is null;") == "t"
assert sql("select (select count(*) from public.orders)+(select count(*) from public.order_submissions);") == "0", "Use an empty disposable test DB"
# Model reported hosted grants, not the SELECT-only local bootstrap. Include
# redundant column grants + grant options so rollback cannot silently broaden them.
sql("""grant select,insert,update,delete,truncate on public.orders,public.order_items to anon,authenticated;
grant insert on public.orders to authenticated with grant option;
grant update(total_amount) on public.orders to authenticated with grant option;
grant insert(order_id) on public.order_items to anon;""")
before = snapshot()
apply("w0b_dependency_review_required", acknowledged=False)
assert snapshot()["grants"] == before["grants"]
print("PASS rollout acknowledgement required; refusal leaves grants unchanged", flush=True)

apply()
after = snapshot()
assert not any(removed(g) for g in after["grants"])
assert after["grants"] == [g for g in before["grants"] if not removed(g)]
run(["-f", str(root / "supabase/tests/order_write_boundary.sql")])
run(["-f", str(root / "supabase/tests/order_submission.sql")])
print("PASS direct DML/TRUNCATE denied; reads/RLS/RPC/atomicity preserved; only intended ACLs removed", flush=True)
sql(before["rollback_sql"])
assert snapshot()["grants"] == before["grants"]
print("PASS exact rollback: table + column scope, grant options and grantors restored", flush=True)

sql("""revoke insert,update,delete,truncate on public.orders,public.order_items from anon,authenticated;
grant update(total_amount) on public.orders to authenticated;
grant insert(order_id) on public.order_items to anon;""")
column_only = snapshot()
apply()
assert not any(removed(g) for g in snapshot()["grants"])
sql(column_only["rollback_sql"])
assert snapshot()["grants"] == column_only["grants"]
sql(before["rollback_sql"])
assert snapshot()["grants"] == before["grants"]
print("PASS column-only write privileges removed and exactly restored", flush=True)

# Do not silently revoke PUBLIC or inherited grants: the whole migration must
# roll back. The following grants/roles exist only in this disposable test setup.
sql("grant insert on public.orders to public;")
try:
    unexpected = snapshot()
    apply("w0b_unreviewed_write_privilege")
    assert snapshot()["grants"] == unexpected["grants"]
finally:
    sql("revoke insert on public.orders from public;")
print("PASS PUBLIC writer detected; migration rolled back without changing PUBLIC", flush=True)

role = "w0b_test_" + uuid.uuid4().hex
sql(f"create role {role}; grant insert on public.orders to {role}; grant {role} to authenticated;")
try:
    unexpected = snapshot()
    apply("w0b_unreviewed_write_privilege")
    assert snapshot()["grants"] == unexpected["grants"]
finally:
    sql(f"revoke {role} from authenticated; revoke insert on public.orders from {role}; drop role {role};")
print("PASS inherited writer detected; migration rolled back without changing membership", flush=True)

role = "w0b_test_" + uuid.uuid4().hex
sql(f"create role {role}; begin; set local role authenticated; grant insert on public.orders to {role}; commit;")
try:
    unexpected = snapshot()
    apply("dependent privileges exist")
    assert snapshot()["grants"] == unexpected["grants"]
finally:
    sql(f"begin; set local role authenticated; revoke insert on public.orders from {role}; commit; drop role {role};")
print("PASS dependent grant rejected with RESTRICT; no cascading revocations", flush=True)

apply()
apply()  # Safe to repeat; no grants are widened, no data/history is changed.
run(["-f", str(root / "supabase/tests/order_write_boundary.sql")])
subprocess.run([sys.executable, str(root / "supabase/tests/order_submission_concurrency.py"),
                "--database-url", args.database_url, "--psql", args.psql], check=True, timeout=60)
assert snapshot()["grants"] == after["grants"]
assert sql("select (select count(*) from public.orders)+(select count(*) from public.order_submissions);") == "0"
print("PASS repeat apply + real W4 concurrency; fixture data cleaned, disposable DB left restricted", flush=True)
