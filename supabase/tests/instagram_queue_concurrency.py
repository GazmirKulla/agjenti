import argparse, pathlib, subprocess, tempfile, time
parser=argparse.ArgumentParser(description='Run queue concurrency checks on an isolated PostgreSQL cluster (no external services).')
parser.add_argument('--pg-bin', required=True, help='Directory containing initdb, pg_ctl and psql')
args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]
bin=pathlib.Path(args.pg_bin)
work=pathlib.Path(tempfile.mkdtemp(prefix='agjenti-queue-pg-'))
pg=work/'data'
def run(cmd):
 r=subprocess.run(cmd,text=True,capture_output=True)
 if r.returncode: raise RuntimeError(r.stderr[-5000:]+r.stdout[-1000:])
 return r.stdout
run([str(bin/'initdb'),'-D',str(pg),'-A','trust','--encoding=UTF8','--locale=C'])
started=False
try:
 run([str(bin/'pg_ctl'),'-D',str(pg),'-l',str(work/'postgres.log'),'-o',f"-k {work} -p 55443 -h ''",'start'])
 started=True
 cmd=[str(bin/'psql'),'-h',str(work),'-p','55443','-d','postgres','-v','ON_ERROR_STOP=1','-X','-q']
 def sql(s): return run(cmd+['-c',s])
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
 for name in ['shared_workflow_context.sql', 'workflow_message_runtime.sql']:
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
 worker=subprocess.Popen(cmd+['-At'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 worker.stdin.write("begin; select external_id from claim_workflow_inbound(null);\n")
 worker.stdin.flush()
 assert worker.stdout.readline().strip()=='first', 'First message not claimed outside pilot'
 assert sql('select count(*) from claim_workflow_inbound(null);').splitlines()[2].strip()=='0', 'Concurrent worker claimed same conversation'
 worker.stdin.write("commit;\n")
 worker.stdin.close()
 assert worker.wait(timeout=10)==0, worker.stderr.read()
 # The lease still protects the stream after the claim transaction commits.
 assert sql('select count(*) from claim_workflow_inbound(null);').splitlines()[2].strip()=='0', 'Active lease did not block second message'
 sql("""
 do $$ declare j workflow_inbound_queue; k workflow_inbound_queue; c uuid:='00000000-0000-4000-8000-000000009003'; s jsonb;
 begin
 select * into j from workflow_inbound_queue where external_id='first';
 perform prepare_workflow_reply(j.id,j.lease_token,c,0,'{"fields":{"size":"M"}}',null,'First reply',null,false);
 perform begin_workflow_send(j.id,j.lease_token);
 perform finish_workflow_send(j.id,j.lease_token,true,'out-first',null);
 select * into k from claim_workflow_inbound(null);
 if k.external_id is distinct from 'second' then raise exception 'Second message not released'; end if;
 select collected into s from conversation_states where conversation_id=c;
 if s->'fields'->>'size' is distinct from 'M' then raise exception 'Next turn lost previous result'; end if;
 begin
 perform prepare_workflow_reply(k.id,k.lease_token,c,0,'{}',null,'Stale reply',null,false);
 raise exception 'Stale write accepted' using errcode='XX001';
 exception when raise_exception then if sqlerrm <> 'stale_state' then raise; end if; end;
 s:=jsonb_set(s,'{fields,color}','"blue"');
 perform prepare_workflow_reply(k.id,k.lease_token,c,1,s,null,'Second reply',null,false);
 if (select revision from conversation_states where conversation_id=c)<>2 then raise exception 'Revision did not advance'; end if;
 if (select collected->'fields' from conversation_states where conversation_id=c) <> '{"size":"M","color":"blue"}'::jsonb then raise exception 'State overwritten'; end if;
 end $$;
 """)
 print('PASS simultaneous workers, FIFO, stale revision rejection, cumulative state',flush=True)
finally:
 if started: run([str(bin/'pg_ctl'),'-D',str(pg),'stop','-m','fast'])
 print('Temporary PostgreSQL stopped',flush=True)
