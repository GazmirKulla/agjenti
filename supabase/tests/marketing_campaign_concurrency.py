"""Real competing PostgreSQL transactions, restricted to a disposable local socket.
Usage: python3 supabase/tests/marketing_campaign_concurrency.py --database campaign_test --port 55439
No provider calls. Only UUID-scoped synthetic rows are removed at the end.
"""
import argparse
import concurrent.futures
import json
import subprocess
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--database', required=True)
parser.add_argument('--port', type=int, default=55439)
args = parser.parse_args()
assert args.database.startswith('campaign_test') and 1024 < args.port < 65536
base = ['psql', '-h', '/tmp', '-p', str(args.port), '-d', args.database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
def sql(text):
    result = subprocess.run(base, input=text, text=True, capture_output=True, check=True)
    return result.stdout.strip()
ids = {k: str(uuid.uuid4()) for k in ['owner', 'b', 'b2', 'conn', 'conn2', 'conv', 'conv2', 'msg', 'msg2']}
payload = json.dumps(dict(name='Concurrency fixture', channel='instagram', body='Offer', terms='', hours=23, orders='all', maxRecipients=1))
def prepare(b):
    campaign = sql(f"select prepare_marketing_campaign('{b}','{ids['owner']}','{payload}');")
    sql(f"select manage_marketing('{b}','{ids['owner']}','confirm','{campaign}','{{\"count\":1}}');")
    return sql(f"select id from marketing_campaign_recipients where campaign_id='{campaign}';")
def compete(recipients):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(lambda r: sql(f"select begin_marketing_send('{r}') is not null;"), recipients))
previous_control = sql('select enabled from marketing_control where singleton;')
try:
    sql(f"insert into auth.users(id,email) values('{ids['owner']}','concurrency-{ids['owner']}@example.invalid'); insert into profiles(id) values('{ids['owner']}') on conflict do nothing; update marketing_control set enabled=true;")
    for suffix in ['', '2']:
        b, conn, conv, msg = [ids[x + suffix] for x in ['b','conn','conv','msg']]
        sql(f"""
        insert into businesses(id,name,slug) values('{b}','Concurrency fixture','concurrency-{b}');
        insert into business_users(business_id,user_id,role) values('{b}','{ids['owner']}','owner');
        insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext) values('{conn}','{b}','fixture-{conn}','never-used');
        insert into conversations(id,business_id,instagram_connection_id,instagram_participant_id,last_inbound_at) values('{conv}','{b}','{conn}','fixture-person',now());
        insert into marketing_settings(business_id,enabled,start_hour,end_hour) values('{b}',true,0,24);
        insert into messages(id,business_id,conversation_id,direction,source,body,external_message_id,instagram_connection_id,marketing_inbound_at) values('{msg}','{b}','{conv}','inbound','customer','Send me offers','fixture-{msg}','{conn}',now());
        select review_marketing_preference('{b}','{msg}','subscribe','Send me offers');
        """)
    first, second = prepare(ids['b']), prepare(ids['b'])
    assert sorted(compete([first, first])) == ['f','t'], 'Same recipient was claimed twice'
    # Remove only this fixture's unsent reservation to test a fresh competing campaign.
    sql(f"delete from message_allowance_reservations where campaign_recipient_id='{first}'; update marketing_campaign_recipients set status='pending',started_at=null where id='{first}'; update marketing_campaigns set next_send_at=null where business_id='{ids['b']}';")
    assert sorted(compete([first, second])) == ['f','t'], 'Two campaigns bypassed frequency/rate boundary'
    # Distinct businesses share the same payer and have exactly one allowance slot left.
    sql(f"delete from marketing_campaigns where business_id in ('{ids['b']}','{ids['b2']}'); select business_allowance('{ids['b']}'); update account_usage set used=999 where user_id='{ids['owner']}';")
    first, second = prepare(ids['b']), prepare(ids['b2'])
    assert sorted(compete([first, second])) == ['f','t'], 'Two businesses overbooked their shared payer quota'
    assert sql(f"select business_allowance('{ids['b']}')->>'available';") == '0'
    print('Concurrent claims, cross-campaign frequency and account-wide last-slot reservation passed')
finally:
    sql(f"delete from businesses where id in ('{ids['b']}','{ids['b2']}'); delete from auth.users where id='{ids['owner']}'; update marketing_control set enabled={'true' if previous_control == 't' else 'false'};")
