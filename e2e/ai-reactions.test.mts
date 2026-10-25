// Actual disposable Auth/PostgREST/Postgres + actual TS runtime/provider adapter.
// Only Meta HTTP is synthetic. Never reads repo .env or external credentials.
import { beforeAll, afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { work, project, verifyContainers, localKeys, sql, safeEnv } from './local.mjs';
import { runAiReaction } from '../src/lib/conversations/ai-reaction-runtime';
import { conversationControl } from '../src/lib/conversations/conversation-control';
import { emptyState } from '../src/lib/workflows/engine';
import { encryptSecret } from '../src/lib/crypto/tokens';
import { createIsolatedExecution, runWithExecution } from '../src/lib/runtime/execution-context';

let db, own, foreign, fixtures, keys, owner, outsider;
const originalFetch=globalThis.fetch;
let calls=[], outcome='sent', beforeAck;
const businesses=[];
const ok=async promise=>{const result=await promise;expect(result.error, result.error?.message).toBeNull();return result.data;};
const rpc=(name,args)=>ok(db.rpc(name,args));
beforeAll(async()=>{
 expect(project).toBe('agjenti-e2e-local-messages-20261024');verifyContainers();
 keys=localKeys();fixtures=JSON.parse(readFileSync(path.join(work,'fixtures.json'),'utf8'));
 [owner,outsider]=fixtures.tenants;
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL',keys.api);vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY',keys.service);vi.stubEnv('TOKEN_ENCRYPTION_KEY',fixtures.encryptionKey);
 vi.stubGlobal('fetch',async(input,init)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(url.origin===keys.api)return originalFetch(input,init);
  if(!['graph.instagram.com','graph.facebook.com'].includes(url.hostname)||url.protocol!=='https:'||
   !/^\/v\d+\.\d+\/synthetic-transport-[a-f0-9-]+\/messages$/.test(url.pathname)||
   new Headers(init?.headers).get('Authorization')!=='Bearer synthetic-transport-local-only'||init?.method!=='POST')throw Error('E2E_EXTERNAL_DENIED');
  const payload=JSON.parse(init.body),ack=`synthetic-ack-${randomUUID()}`;calls.push({payload,ack,host:url.hostname});
  if(beforeAck)await beforeAck(ack);
  if(outcome==='uncertain')throw Error('Synthetic network timeout');
  return Response.json(outcome==='failed'?{error:{code:100}}:url.hostname==='graph.instagram.com'?{recipient_id:payload.recipient.id}:{messages:[{id:ack}]},{status:outcome==='failed'?400:200});
 });
 db=createClient(keys.api,keys.service,{auth:{persistSession:false,autoRefreshToken:false}});
 own=createClient(keys.api,keys.anon,{auth:{persistSession:false,autoRefreshToken:false}});
 foreign=createClient(keys.api,keys.anon,{auth:{persistSession:false,autoRefreshToken:false}});
 await ok(own.auth.signInWithPassword({email:owner.email,password:fixtures.password}));
 await ok(foreign.auth.signInWithPassword({email:outsider.email,password:fixtures.password}));
});
afterEach(async()=>{
 beforeAck=undefined;outcome='sent';calls=[];
 for(const id of businesses.splice(0))await ok(db.from('businesses').delete().eq('id',id));
});
afterAll(async()=>{await own?.auth.signOut();await foreign?.auth.signOut();vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function fixture(channel='instagram',optIn=true){
 const b=randomUUID(),c=randomUUID(),m=randomUUID(),conn=randomUUID(),account=`synthetic-transport-${randomUUID()}`,person=`synthetic-person-${randomUUID()}`,external=`synthetic-mid-${randomUUID()}`,lease=randomUUID();
 await ok(db.from('businesses').insert({id:b,name:'Synthetic AI reaction test',slug:`ai-reaction-${b}`,auto_reply:true}));businesses.push(b);
 expect((await ok(db.from('businesses').select('ai_reactions_enabled').eq('id',b).single())).ai_reactions_enabled).toBe(false);
 if(optIn)await ok(db.from('businesses').update({ai_reactions_enabled:true}).eq('id',b));
 await ok(db.from('business_users').insert({business_id:b,user_id:owner.userId,role:'owner'}));
 await ok(db.from(`${channel}_connections`).insert({id:conn,business_id:b,...(channel==='instagram'?{ig_user_id:account}:{phone_number_id:account,waba_id:'synthetic'}),status:'connected',access_token_ciphertext:encryptSecret('synthetic-transport-local-only')}));
 await ok(db.from('conversations').insert({id:c,business_id:b,channel,[`${channel}_connection_id`]:conn,[`${channel}_participant_id`]:person,status:'active',auto_reply:null,last_inbound_at:new Date().toISOString()}));
 await ok(db.from('messages').insert({id:m,business_id:b,conversation_id:c,[`${channel}_connection_id`]:conn,external_message_id:external,direction:'inbound',source:'customer',body:'Faleminderit'}));
 await ok(db.from('conversation_states').insert({business_id:b,conversation_id:c,collected:{syntheticFact:'preserved'},revision:7}));
 const q=await ok(db.from('workflow_inbound_queue').insert({business_id:b,channel,connection_id:conn,participant_id:person,external_id:external,payload:{channel,externalMessageId:external},conversation_id:c,status:'prepared',reply:'Normal prepared reply',lease_token:lease,leased_until:new Date(Date.now()+180000).toISOString()}).select('id').single());
 const input={businessId:b,conversationId:c,messageId:m,text:'Faleminderit',channel,accountId:account,participantId:person,autoReplyEnabled:true,humanTakeover:false,jobId:q.id,leaseToken:lease};
 const args={p_business:b,p_conversation:c,p_message:m,p_request:randomUUID(),p_emoji:'😊',p_job:q.id,p_lease:lease};
 return {b,c,m,conn,account,person,external,input,args,
  reserve:()=>rpc('reserve_ai_message_reaction',args),
  begin:r=>rpc('begin_ai_message_reaction',{p_request:args.p_request,p_token:r.token,p_account:account}),
  manual:(emoji='',revision=1)=>db.rpc('reserve_message_reaction',{p_business:b,p_user:owner.userId,p_conversation:c,p_message:m,p_request:randomUUID(),p_revision:revision,p_emoji:emoji}),
  read:()=>rpc('read_message_reactions',{p_business:b,p_user:owner.userId,p_conversation:c}),
  finish:(r,status='sent',ack=null)=>rpc('finish_message_reaction',{p_request:args.p_request,p_token:r.token,p_status:status,p_external:ack,p_error:null})};
}
test('schema: atomic begin exists and both AI RPCs deny anon/authenticated',()=>{
 expect(sql("select to_regprocedure('public.begin_ai_message_reaction(uuid,uuid,text)') is not null;")).toBe('t');
 expect(sql("select bool_and(not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE') and has_function_privilege('service_role',oid,'EXECUTE') and not prosecdef) from pg_proc where pronamespace='public'::regnamespace and proname in ('begin_ai_message_reaction','reserve_ai_message_reaction');")).toBe('t');
});
for(const channel of ['instagram','whatsapp'])describe(channel,()=>{
 test('acknowledgement pause is not staff takeover and never advances the workflow',async()=>{
  const f=await fixture(channel),before=emptyState();
  const turn=conversationControl({businessId:f.b,message:'Faleminderit',state:before,mode:'production',hasPhoto:false});
  expect(turn?.nextState.conversationPaused).toBe(true);expect(turn?.handoff).not.toBe(true);
  expect(turn?.nextState.step_key).toBe(before.step_key);expect(turn?.nextState.customer).toEqual(before.customer);
  await ok(db.from('conversation_states').update({collected:turn.nextState}).eq('conversation_id',f.c));
  expect((await runAiReaction(f.input)).result?.status).toBe('sent');expect(calls).toHaveLength(1);
  expect(await ok(db.from('conversation_states').select('revision,collected').eq('conversation_id',f.c).single())).toEqual({revision:7,collected:turn.nextState});
  expect(await ok(db.from('workflow_inbound_queue').select('status,reply').eq('id',f.input.jobId).single())).toEqual({status:'prepared',reply:'Normal prepared reply'});
 });
 test('default OFF is inert; inherited ON sends exactly once using provider ID; UI reload and RLS',async()=>{
  const f=await fixture(channel,false);
  await runAiReaction(f.input);expect(calls).toHaveLength(0);
  await ok(db.from('businesses').update({ai_reactions_enabled:true}).eq('id',f.b));
  const results=await Promise.all(Array.from({length:5},()=>runAiReaction(f.input)));
  expect(calls).toHaveLength(1);expect(results.filter(r=>r.result?.status==='sent')).toHaveLength(1);
  const payload=calls[0].payload;expect(payload.payload?.message_id??payload.reaction.message_id).toBe(f.external);
  expect(payload.message??payload.text).toBeUndefined();
  const [r]=await f.read();expect(r).toMatchObject({messageId:f.m,emoji:'😊',status:'sent',canRetry:false});
  const op=await ok(db.from('message_reaction_operations').select('actor_kind,user_id,attempt').eq('id',r.requestId).single());expect(op).toEqual({actor_kind:'ai',user_id:null,attempt:1});
  expect(await ok(own.from('message_reactions').select('id').eq('message_id',f.m))).toHaveLength(1);
  expect(await ok(foreign.from('message_reactions').select('id').eq('message_id',f.m))).toHaveLength(0);
  expect((await own.rpc('reserve_ai_message_reaction',f.args)).error).toBeTruthy();
  expect((await foreign.rpc('begin_ai_message_reaction',{p_request:r.requestId,p_token:randomUUID(),p_account:f.account})).error).toBeTruthy();
  expect((await db.rpc('reserve_ai_message_reaction',{...f.args,p_business:outsider.id})).error).toBeTruthy();
  await runAiReaction(f.input);expect(calls).toHaveLength(1);
  expect(await ok(db.from('messages').select('id').eq('conversation_id',f.c))).toHaveLength(1);
  expect(await ok(db.from('conversation_states').select('revision,collected').eq('conversation_id',f.c).single())).toEqual({revision:7,collected:{syntheticFact:'preserved'}});
  expect(await ok(db.from('workflow_inbound_queue').select('status,reply').eq('id',f.input.jobId).single())).toEqual({status:'prepared',reply:'Normal prepared reply'});
 });
 test.each(['paused','off','business_off','optout','lease','revision','handoff','connection','account','expiry'])('fresh %s boundary blocks reserved operation',async guard=>{
  const f=await fixture(channel),r=await f.reserve();expect(r.claimed).toBe(true);
  if(guard==='paused')await ok(db.from('conversations').update({status:'paused'}).eq('id',f.c));
  if(guard==='off')await ok(db.from('conversations').update({auto_reply:false}).eq('id',f.c));
  if(guard==='business_off')await ok(db.from('businesses').update({auto_reply:false}).eq('id',f.b));
  if(guard==='optout')await ok(db.from('businesses').update({ai_reactions_enabled:false}).eq('id',f.b));
  if(guard==='lease')await ok(db.from('workflow_inbound_queue').update({lease_token:randomUUID()}).eq('id',f.input.jobId));
  if(guard==='revision')await ok(db.from('message_reactions').update({revision:9}).eq('message_id',f.m));
  if(guard==='handoff')await ok(db.from('conversation_states').update({collected:{staffHandoff:{reason:'synthetic'}}}).eq('conversation_id',f.c));
  if(guard==='connection')await ok(db.from(`${channel}_connections`).update({status:'disconnected'}).eq('id',f.conn));
  if(guard==='expiry')await ok(db.from('conversations').update({last_inbound_at:'2000-01-01T00:00:00Z'}).eq('id',f.c));
  const begin=guard==='account'?rpc('begin_ai_message_reaction',{p_request:f.args.p_request,p_token:r.token,p_account:'wrong-account'}):f.begin(r);
  expect(await begin).toBe(false);expect((await f.read())[0].status).toBe('failed');expect(calls).toHaveLength(0);
 });
 test('manual intent supersedes reserved AI; stale AI cannot overwrite or impersonate operator',async()=>{
  const f=await fixture(channel),r=await f.reserve();
  const manual=await ok(f.manual('👍'));expect(manual.claimed).toBe(true);
  expect(await f.begin(r)).toBe(false);await f.finish(r);expect((await f.read())[0].emoji).toBe('');
  expect((await db.rpc('reserve_message_reaction',{p_business:f.b,p_user:owner.userId,p_conversation:f.c,p_message:f.m,p_request:f.args.p_request,p_revision:1,p_emoji:'😊',p_retry:1})).error).toBeTruthy();
  expect((await f.reserve()).claimed).toBe(false);
 });
 test('concurrent manual override vs begin has exactly one winner',async()=>{
  const f=await fixture(channel),r=await f.reserve();
  const [begun,manual]=await Promise.all([f.begin(r),f.manual('👍')]);
  expect(Number(begun)+Number(manual.data?.claimed===true)).toBe(1);
  expect(await f.begin(r)).toBe(false);
 });
 test.each(['failed','uncertain'])('%s provider outcome never retries HTTP or fabricates success',async status=>{
  const f=await fixture(channel);outcome=status;
  expect((await runAiReaction(f.input)).result?.status).toBe(status);
  expect((await f.read())[0]).toMatchObject({emoji:'',status,canRetry:false});
  for(let n=0;n<3;n++)expect((await runAiReaction(f.input)).result?.status).not.toBe('sent');
  expect(calls).toHaveLength(1);
  if(status==='uncertain')expect((await f.manual('👍')).error).toBeTruthy();
 });
 test('crash before dispatch expires safely; crash after dispatch remains uncertain',async()=>{
  const f=await fixture(channel),r=await f.reserve();
  await ok(db.from('message_reaction_operations').update({started_at:'2000-01-01T00:00:00Z'}).eq('id',f.args.p_request));
  expect((await f.read())[0]).toMatchObject({status:'failed',canRetry:false});expect(await f.begin(r)).toBe(false);
  const next=await fixture(channel),s=await next.reserve();expect(await next.begin(s)).toBe(true);
  await ok(db.from('message_reaction_operations').update({started_at:'2000-01-01T00:00:00Z'}).eq('id',next.args.p_request));
  expect((await next.read())[0]).toMatchObject({status:'uncertain',canRetry:false});expect(await next.begin(s)).toBe(false);
 });
 test('isolated Agent Test cannot reserve or dispatch even when business opt-in is ON',async()=>{
  const f=await fixture(channel);await runWithExecution(createIsolatedExecution(),()=>runAiReaction(f.input));
  expect(calls).toHaveLength(0);expect(await f.read()).toEqual([]);
 });
});
test('manual removal tombstone cannot be resurrected by a new AI request',async()=>{
 const f=await fixture(),request=randomUUID();
 const manual=await rpc('reserve_message_reaction',{p_business:f.b,p_user:owner.userId,p_conversation:f.c,p_message:f.m,p_request:request,p_revision:0,p_emoji:''});
 await rpc('finish_message_reaction',{p_request:request,p_token:manual.token,p_status:'sent',p_external:null,p_error:null});
 expect((await f.reserve()).claimed).toBe(false);await runAiReaction(f.input);expect(calls).toHaveLength(0);
 expect((await f.read())[0].emoji).toBe('');
});
test('a real concurrent takeover transaction fences begin without waiting or dispatching',async()=>{
 const f=await fixture(),r=await f.reserve();
 const child=spawn('docker',['exec','-i',`supabase_db_${project}`,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{env:safeEnv(),stdio:['pipe','pipe','pipe']});
 let output='',error='';child.stderr.on('data',data=>{error+=data;});
 const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(error)));});
 const locked=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(Error('Local takeover barrier timeout'));},5000);
  child.stdout.on('data',data=>{output+=data;if(output.includes('takeover-locked')){clearTimeout(timer);resolve();}});
 });
 child.stdin.end(`begin;update conversations set status='paused',auto_reply=false where id='${f.c}';select 'takeover-locked';select pg_sleep(3);commit;`);
 await locked;
 const result=await db.rpc('begin_ai_message_reaction',{p_request:f.args.p_request,p_token:r.token,p_account:f.account});
 expect(result.data).not.toBe(true);if(result.error)expect(result.error.code).toBe('55P03');
 await completed;expect(await f.begin(r)).toBe(false);expect(calls).toHaveLength(0);
});
test('takeover after dispatch cannot cancel HTTP but never resends the reaction',async()=>{
 const f=await fixture();
 beforeAck=()=>ok(db.from('conversations').update({status:'paused',auto_reply:false}).eq('id',f.c));
 expect((await runAiReaction(f.input)).result?.status).toBe('sent');
 await runAiReaction(f.input);expect(calls).toHaveLength(1);
 expect((await f.read())[0].status).toBe('sent');
});
test('different conversation/job binding cannot reserve an AI effect',async()=>{
 const first=await fixture(),second=await fixture();
 const bad=await db.rpc('reserve_ai_message_reaction',{...first.args,p_job:second.input.jobId,p_lease:second.input.leaseToken});
 expect(bad.error).toBeNull();expect(bad.data.claimed).toBe(false);expect(await first.read()).toEqual([]);
 expect((await db.rpc('reserve_ai_message_reaction',{...first.args,p_message:second.m})).error).toBeTruthy();
 expect(calls).toHaveLength(0);
});
test('WA early/duplicate/late failed receipts reconcile the shared authoritative ledger',async()=>{
 const f=await fixture('whatsapp');
 beforeAck=ack=>rpc('record_transport_receipt',{p_connection:f.conn,p_participant:f.person,p_external:ack,p_status:'failed',p_occurred:new Date().toISOString()});
 expect((await runAiReaction(f.input)).result?.status).toBe('failed');expect(calls).toHaveLength(1);expect((await f.read())[0]).toMatchObject({emoji:'',status:'failed'});
 for(const status of ['failed','sent','failed'])await rpc('record_transport_receipt',{p_connection:f.conn,p_participant:f.person,p_external:calls[0].ack,p_status:status,p_occurred:new Date().toISOString()});
 expect((await f.read())[0].status).toBe('failed');await runAiReaction(f.input);expect(calls).toHaveLength(1);
});
