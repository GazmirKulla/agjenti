"""Run against a disposable, migrated local Docker database ending in _test."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import subprocess
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--container', required=True)
parser.add_argument('--database', required=True)
a = parser.parse_args()
if not a.container.startswith('supabase_db_agjenti-e2e-local') or not a.database.endswith('_test'):
    parser.error('Only an isolated local Supabase test database is allowed')

def sql(query):
    result = subprocess.run(['docker', 'exec', '-i', a.container, 'psql', '-X', '-qAt', '-U', 'postgres',
                           '-d', a.database, '-v', 'ON_ERROR_STOP=1'], input=query, text=True,
                          capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

business = str(uuid.uuid4())
try:
    sql(f"insert into public.businesses(id,name,slug) values('{business}','Concurrent numbering','number-{business}');")
    def create(_):
        return int(sql(f"set role service_role; insert into public.orders(business_id) values('{business}') returning order_number;"))
    with ThreadPoolExecutor(max_workers=8) as pool:
        numbers = list(pool.map(create, range(24)))
    assert sorted(numbers) == list(range(1001, 1025)), numbers
    assert sql(f"select count(distinct order_number)=24 from public.orders where business_id='{business}'") == 't'
    print('PASS: 24 concurrent service-role inserts have distinct consecutive numbers')
finally:
    sql(f"delete from public.businesses where id='{business}';")
