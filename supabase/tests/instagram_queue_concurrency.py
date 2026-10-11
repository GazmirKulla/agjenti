import argparse, pathlib, select, subprocess, tempfile, time
parser=argparse.ArgumentParser(description='Run queue concurrency checks on an isolated PostgreSQL cluster (no external services).')
parser.add_argument('--pg-bin', required=True, help='Directory containing initdb, pg_ctl and psql')
args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]
bin=pathlib.Path(args.pg_bin)
work=pathlib.Path(tempfile.mkdtemp(prefix='agjenti-queue-pg-'))
pg=work/'data'
def run(cmd):
 r=subprocess.run(cmd,text=True,capture_output=True,timeout=60)
 if r.returncode: raise RuntimeError(r.stderr[-5000:]+r.stdout[-1000:])
 return r.stdout
run([str(bin/'initdb'),'-D',str(pg),'-A','trust','--encoding=UTF8','--locale=C'])
started=False
workers=[]
try:
 run([str(bin/'pg_ctl'),'-D',str(pg),'-l',str(work/'postgres.log'),'-o',f"-k {work} -p 55443 -h ''",'start'])
 started=True
 cmd=[str(bin/'psql'),'-h',str(work),'-p','55443','-d','postgres','-v','ON_ERROR_STOP=1','-X','-q']
 def sql(s): return run(cmd+['-c',s])
 def scalar(s): return run(cmd+['-At','-c',s]).strip()
 def start_worker(statement):
  worker=subprocess.Popen(cmd+['-At'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  workers.append(worker)
  worker.stdin.write(statement+'\n')
  worker.stdin.flush()
  return worker
 def read_worker(worker):
  assert select.select([worker.stdout],[],[],10)[0], 'Worker did not respond within 10 seconds'
  return worker.stdout.readline().strip()
 def commit_worker(worker):
  worker.stdin.write('commit;\n')
  worker.stdin.close()
  assert worker.wait(timeout=10)==0, worker.stderr.read()
 sql("""create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 alter default privileges in schema public grant all on tables to service_role;
 alter default privileges in schema public grant select on tables to authenticated;
 """)
 for p in sorted((root/'supabase/migrations').glob('*.sql')):
  run(cmd+(['-1'] if 'begin;' not in p.read_text().lower() else [])+['-f',str(p)])
 print('PASS all migrations from scratch',flush=True)
 for name in ['shared_workflow_context.sql', 'workflow_message_runtime.sql', 'instagram_message_batches.sql', 'workflow_staff_handoff.sql', 'workflow_delivery_receipts.sql']:
  run(cmd+['-f',str(root/'supabase/tests'/name)])
  print('PASS '+name,flush=True)
 # Dedicated committed fixtures let independent sessions contend on actual row locks.
 sql("""
 insert into businesses(id,name,slug,auto_reply) values ('00000000-0000-4000-8000-000000009001','Queue test','queue-concurrency',true);
 insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values ('00000000-0000-4000-8000-000000009002','00000000-0000-4000-8000-000000009001','queue-test-account','test','connected');
 insert into conversations(id,business_id,instagram_participant_id,instagram_connection_id,channel) values ('00000000-0000-4000-8000-000000009003','00000000-0000-4000-8000-000000009001','person','00000000-0000-4000-8000-000000009002','instagram');
 insert into conversation_states(conversation_id,business_id) values ('00000000-0000-4000-8000-000000009003','00000000-0000-4000-8000-000000009001');
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel) values
 ('00000000-0000-4000-8000-000000009001','00000000-0000-4000-8000-000000009002','person','first','{}','instagram'),
 ('00000000-0000-4000-8000-000000009001','00000000-0000-4000-8000-000000009002','person','second','{}','instagram');
 """)
 # Worker A holds the claim transaction open; worker B must not skip to the next message.
 worker=start_worker("begin; select external_id from claim_workflow_inbound(null);")
 assert read_worker(worker)=='first', 'First message not claimed outside pilot'
 assert scalar('select count(*) from claim_workflow_inbound(null);')=='0', 'Concurrent worker claimed same conversation'
 # A different participant can complete a turn while A still holds its row lock.
 sql("""
 insert into conversations(id,business_id,instagram_participant_id,instagram_connection_id,channel) values ('00000000-0000-4000-8000-000000009004','00000000-0000-4000-8000-000000009001','other-person','00000000-0000-4000-8000-000000009002','instagram');
 insert into conversation_states(conversation_id,business_id) values ('00000000-0000-4000-8000-000000009004','00000000-0000-4000-8000-000000009001');
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel) values
 ('00000000-0000-4000-8000-000000009001','00000000-0000-4000-8000-000000009002','other-person','other-first','{}','instagram');
 do $$ declare j workflow_inbound_queue; c uuid:='00000000-0000-4000-8000-000000009004';
 begin
 select * into j from claim_workflow_inbound(null);
 if j.external_id is distinct from 'other-first' then raise exception 'Independent participant blocked'; end if;
 begin
  perform prepare_workflow_reply(j.id,j.lease_token,'00000000-0000-4000-8000-000000009003',0,'{}',null,'Wrong participant',null,false);
  raise exception 'Cross-participant write accepted' using errcode='XX001';
 exception when raise_exception then if sqlerrm <> 'invalid_conversation' then raise; end if; end;
 perform prepare_workflow_reply(j.id,j.lease_token,c,0,'{"fields":{"size":"L"},"context":{"profile":{"name":"Other client"}}}',null,'Other reply',null,false);
 if not begin_workflow_send(j.id,j.lease_token) then raise exception 'Independent reply blocked'; end if;
 perform finish_workflow_send(j.id,j.lease_token,true,'out-other',null);
 if (select revision from conversation_states where conversation_id='00000000-0000-4000-8000-000000009003')<>0 then raise exception 'Other participant state modified'; end if;
 end $$;
 """)
 print('PASS independent participant progresses under concurrent lock; foreign state write rejected',flush=True)
 commit_worker(worker)
 # The lease still protects the stream after the claim transaction commits.
 assert scalar('select count(*) from claim_workflow_inbound(null);')=='0', 'Active lease did not block second message'
 sql("""
 do $$ declare j workflow_inbound_queue; k workflow_inbound_queue; c uuid:='00000000-0000-4000-8000-000000009003'; s jsonb;
 begin
 select * into j from workflow_inbound_queue where external_id='first';
 perform prepare_workflow_reply(j.id,j.lease_token,c,0,'{"fields":{"size":"M"},"visual":{"versionId":"pinned-version","nodeId":"collect-color","values":{"size":"M"}}}',null,'First reply',null,false);
 perform begin_workflow_send(j.id,j.lease_token);
 perform finish_workflow_send(j.id,j.lease_token,true,'out-first',null);
 select * into k from claim_workflow_inbound(null);
 if k.external_id is distinct from 'second' then raise exception 'Second message not released'; end if;
 select collected into s from conversation_states where conversation_id=c;
 if s->'fields'->>'size' is distinct from 'M' then raise exception 'Next turn lost previous result'; end if;
 if s->'visual' is distinct from '{"versionId":"pinned-version","nodeId":"collect-color","values":{"size":"M"}}'::jsonb then raise exception 'Next turn lost cursor'; end if;
 begin
 perform prepare_workflow_reply(k.id,k.lease_token,c,0,'{}',null,'Stale reply',null,false);
 raise exception 'Stale write accepted' using errcode='XX001';
 exception when raise_exception then if sqlerrm <> 'stale_state' then raise; end if; end;
 s:=jsonb_set(s,'{fields,color}','"blue"');
 s:=jsonb_set(s,'{visual,nodeId}','"confirm"');
 s:=jsonb_set(s,'{visual,values,color}','"blue"');
 perform prepare_workflow_reply(k.id,k.lease_token,c,1,s,null,'Second reply',null,false);
 if (select revision from conversation_states where conversation_id=c)<>2 then raise exception 'Revision did not advance'; end if;
 if (select collected->'fields' from conversation_states where conversation_id=c) <> '{"size":"M","color":"blue"}'::jsonb then raise exception 'State overwritten'; end if;
 if (select collected->'visual' from conversation_states where conversation_id=c) is distinct from '{"versionId":"pinned-version","nodeId":"confirm","values":{"size":"M","color":"blue"}}'::jsonb then raise exception 'Cursor overwritten'; end if;
 if not begin_workflow_send(k.id,k.lease_token) then raise exception 'Second send blocked'; end if;
 perform finish_workflow_send(k.id,k.lease_token,true,'out-second',null);
 if (select collected->'fields' from conversation_states where conversation_id='00000000-0000-4000-8000-000000009004') <> '{"size":"L"}'::jsonb then raise exception 'Other participant state overwritten'; end if;
 if (select profile->>'name' from conversation_profiles where participant_id='other-person') is distinct from 'Other client' then raise exception 'Other profile overwritten'; end if;
 if exists(select 1 from conversation_profiles where participant_id='person' and profile ? 'name') then raise exception 'Profile leaked between participants'; end if;
 if (select count(*) from messages where conversation_id=c and direction='outbound')<>2 then raise exception 'Wrong reply count'; end if;
 if (select count(*) from messages where conversation_id='00000000-0000-4000-8000-000000009004' and direction='outbound' and body='Other reply')<>1 then raise exception 'Reply leaked between participants'; end if;
 end $$;
 """)
 print('PASS simultaneous workers, FIFO, stale revision rejection, cumulative state',flush=True)
 # Match enqueueWorkflowMessage's ON CONFLICT DO NOTHING using two real sessions.
 insert_duplicate="""insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel)
 values ('00000000-0000-4000-8000-000000009001','00000000-0000-4000-8000-000000009002','person','duplicate','{"text":"original"}','instagram')
 on conflict(connection_id,external_id) do nothing"""
 first=start_worker('begin; '+insert_duplicate+" returning external_id;")
 assert read_worker(first)=='duplicate', 'First delivery was not inserted'
 duplicate=start_worker("set application_name='duplicate-webhook-test'; "+insert_duplicate.replace('original','redelivery')+" returning external_id;")
 duplicate.stdin.close()
 deadline=time.monotonic()+10
 while scalar("select count(*) from pg_stat_activity where application_name='duplicate-webhook-test' and wait_event_type='Lock'")!='1':
  assert duplicate.poll() is None, 'Duplicate did not contend with uncommitted delivery'
  assert time.monotonic()<deadline, 'Duplicate did not reach unique constraint lock'
  time.sleep(0.02)
 commit_worker(first)
 assert duplicate.wait(timeout=10)==0, duplicate.stderr.read()
 assert duplicate.stdout.read().strip()=='', 'Concurrent duplicate created a second job'
 sql("""
 do $$ declare j workflow_inbound_queue; c uuid:='00000000-0000-4000-8000-000000009003';
 begin
 select * into j from claim_workflow_inbound(null);
 if j.external_id is distinct from 'duplicate' or j.attempts<>1 then raise exception 'Duplicate claimed incorrectly'; end if;
 if j.payload->>'text' is distinct from 'original' then raise exception 'Redelivery replaced original payload'; end if;
 end $$;
 """)
 # Replays during processing and after completion must not reset the lease/state.
 sql(insert_duplicate)
 assert scalar('select count(*) from claim_workflow_inbound(null);')=='0', 'Duplicate was processed while leased'
 sql("""
 do $$ declare j workflow_inbound_queue; c uuid:='00000000-0000-4000-8000-000000009003'; s jsonb;
 begin
 select * into j from workflow_inbound_queue where external_id='duplicate';
 select collected into s from conversation_states where conversation_id=c;
 perform prepare_workflow_reply(j.id,j.lease_token,c,2,s,null,'One duplicate reply',null,false);
 if not begin_workflow_send(j.id,j.lease_token) then raise exception 'Duplicate send blocked'; end if;
 perform finish_workflow_send(j.id,j.lease_token,true,'out-duplicate',null);
 end $$;
 """)
 sql(insert_duplicate)
 assert scalar('select count(*) from claim_workflow_inbound(null);')=='0', 'Completed duplicate was claimed again'
 sql("""
 do $$ begin
 if (select count(*) from workflow_inbound_queue where external_id='duplicate')<>1 then raise exception 'Duplicate jobs'; end if;
 if (select attempts from workflow_inbound_queue where external_id='duplicate')<>1 then raise exception 'Duplicate execution'; end if;
 if (select revision from conversation_states where conversation_id='00000000-0000-4000-8000-000000009003')<>3 then raise exception 'Duplicate state advancement'; end if;
 if (select count(*) from messages where external_message_id='out-duplicate')<>1 then raise exception 'Duplicate outbound reply'; end if;
 if (select count(*) from agent_turns where conversation_id='00000000-0000-4000-8000-000000009003' and reply='One duplicate reply')<>1 then raise exception 'Duplicate turn'; end if;
 end $$;
 """)
 print('PASS concurrent duplicate delivery, replay during lease/after send, single state advancement and reply',flush=True)
 # Competing batch-aware workers must claim different participants, never the
 # individual members of another worker's still-uncommitted batch.
 sql("""
 insert into workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,channel,created_at)
 select '00000000-0000-4000-8000-000000009001','00000000-0000-4000-8000-000000009002',person,person||'-'||n,'{}','instagram',clock_timestamp()-interval '4 seconds'
 from unnest(array['batch-a','batch-b']) person cross join generate_series(1,2)n order by person,n;
 """)
 first_batch=start_worker("begin; select participant_id||':'||jsonb_array_length(batch_payloads) from claim_workflow_inbound_batch(null);")
 assert read_worker(first_batch)=='batch-a:2', 'First batch membership incorrect'
 assert scalar("select participant_id||':'||jsonb_array_length(batch_payloads) from claim_workflow_inbound_batch(null);")=='batch-b:2', 'Independent batch blocked or first batch split'
 assert scalar('select count(*) from claim_workflow_inbound_batch(null);')=='0', 'Concurrent batch member was reclaimed'
 commit_worker(first_batch)
 assert scalar("select count(*) from workflow_inbound_queue where status='batched'")=='2', 'Concurrent batch membership lost'
 print('PASS competing batch workers preserve membership and participant isolation',flush=True)
finally:
 for worker in workers:
  if worker.poll() is None:
   worker.kill()
   worker.wait(timeout=10)
 if started: run([str(bin/'pg_ctl'),'-D',str(pg),'stop','-m','fast'])
 print('Temporary PostgreSQL stopped',flush=True)
