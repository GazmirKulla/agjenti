// Real local UI/Auth/actions/sealed sessions + SQL; deterministic model only.
// Uses the existing app-r3 loopback transport. No separate provider process.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createDecipheriv} from 'node:crypto';
import path from 'node:path';
import {test,expect} from '@playwright/test';
import {work,project,verifyContainers,localKeys,sql} from './local.mjs';
import {quote,json} from './fixtures.mjs';
import {observeServerActions,readServerAction,resultFromFlight} from './flight.mjs';
const f=JSON.parse(readFileSync(path.join(work,'fixtures.json'),'utf8')),keys=localKeys(),origin='http://localhost:3103';
const tenant=kind=>f.tenants.find(t=>t.kind===kind), modelEvidence=new Map();
const composite='Rikujto perseri emrin, biznesin, Instagramin dhe pyetjet tipike, pa te dhena te reja.';
const expected={name:'Drita',business_type:'Shitje librash online',instagram_handle:'synthetic_books',stated_needs:'çmimet dhe madhësitë'};
const correct='Emri yt: Drita. Biznesi yt: Shitje librash online. Instagrami yt: synthetic_books. Pyetjet tipike: çmimet dhe madhësitë.';
const counts=()=>sql(`select json_build_array((select count(*) from public.orders),(select count(*) from public.order_submissions),
  (select count(*) from public.bookings),(select count(*) from public.customers),(select count(*) from public.workflow_inbound_queue),
  (select count(*) from public.workflow_booking_effects),(select count(*) from public.integrations),(select count(*) from public.messages));`);
let server,before;
test.beforeAll(async()=>{
  expect(project).toBe('agjenti-e2e-local-recovery-3a-20261023');verifyContainers();before=counts();
  server=http.createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/v1/responses'||req.headers.authorization!=='Bearer synthetic-r3-local-only'){res.writeHead(403);res.end();return;}
    try{
      let body='';for await(const part of req){body+=part;if(body.length>1000000)throw Error('oversize');}
      const r=JSON.parse(body),format=r.text?.format?.name;
      let text;
      if(format==='customer_facts')text='{"facts":[]}';
      else if(format==='workflow_guidance')text='{"action":"continue","target":null,"confidence":1,"evidence":""}';
      else if(format==='booking_details'){
        const input=JSON.parse(r.input),message=input.message;
        text=JSON.stringify({bookingIntent:true,cancel:false,serviceId:input.services.find(s=>message.includes(s.name))?.id??null,
          date:message.match(/\b20\d\d-\d\d-\d\d\b/)?.[0]??null,time:message.match(/\b\d\d:\d\d\b/)?.[0]??null,name:null,contact:null});
      }else{
        const message=String(r.input).match(/^Customer message: ([^\n]*)/)?.[1]??'';
        const line=String(r.input).split('\n').find(l=>l.startsWith('Collected state (source of truth): ')||l.startsWith('Already supplied customer facts (not business policy): '));
        const projection=line?JSON.parse(line.slice(line.indexOf(': ')+2)):null;
        text=message==='Cilat të dhëna të duhen?'?'[[ask_customer:name,business_type,instagram_handle,stated_needs]]'
          :message.startsWith('Më përmblidh saktë')?correct
          :/kujto|quhem|dime|dimë|preferencat/i.test(message)?'Nuk e di emrin. Nuk më ke dhënë asnjë të dhënë për këtë kërkesë.'
          :'Informacion sintetik, pa veprime biznesi.';
        modelEvidence.set(message,{projection,generated:text});
      }
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'p1-synthetic',object:'response',status:'completed',
        output:[{type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[]}]}]}));
    }catch{res.writeHead(400);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(55325,'127.0.0.1',resolve);});
});
test.afterAll(async()=>{try{expect(counts()).toBe(before);}finally{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));}});
function decode(token){const[,iv,tag,data]=token.split('.');const d=createDecipheriv('aes-256-gcm',Buffer.from(f.encryptionKey,'hex'),Buffer.from(iv,'base64url'));d.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64url')),d.final()]).toString());}
async function login(page,context,t){
  await observeServerActions(page);
  await context.route('**/*',r=>[origin,keys.api].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
  await context.routeWebSocket('**/*',r=>new URL(r.url()).origin==='ws://localhost:3103'?r.connectToServer():r.close());
  await page.goto('/login');await page.getByLabel('Email-i',{exact:true}).fill(t.email);await page.getByPlaceholder('Fjalëkalimi yt',{exact:true}).fill(f.password);
  await page.getByRole('button',{name:'Hyr në panel →',exact:true}).click();await expect(page).toHaveURL(`${origin}/b/${t.slug}`);
  await page.goto(`/b/${t.slug}/agents/test`);
}
function rpcRoundtrip(t,state,reply){
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='10s';
  do $test$ declare c uuid:=gen_random_uuid(); ch uuid:=gen_random_uuid(); q public.workflow_inbound_queue; s jsonb:=${json(state)};
  begin
  insert into public.instagram_connections(id,business_id,ig_user_id,access_token_ciphertext) values(ch,${quote(t.id)},ch::text,'synthetic-only');
  insert into public.conversations(id,business_id,instagram_participant_id,instagram_connection_id,auto_reply,status) values(c,${quote(t.id)},c::text,ch,true,'active');
  insert into public.conversation_states(conversation_id,business_id) values(c,${quote(t.id)});
  insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,conversation_id,status,lease_token,leased_until)
    values(${quote(t.id)},ch,c::text,c::text,'{}',c,'processing',gen_random_uuid(),now()+interval '2 minutes') returning * into q;
  perform public.prepare_workflow_reply(q.id,q.lease_token,c,0,s,null,${quote(reply)},null,false);
  if (select collected from public.conversation_states where conversation_id=c) is distinct from s then raise exception 'roundtrip_failed'; end if;
  if exists(select 1 from public.conversation_profiles where business_id=${quote(t.id)} and participant_id=c::text and profile::text like '%instagram_handle%') then raise exception 'profile_leak'; end if;
  end $test$; rollback;`);
}
function sender(page,t,evidence){let turns=0;return async message=>{
  const input=page.locator('#agent-test-message');await input.fill(message);const {result,request}=await readServerAction(page,()=>input.press('Enter'));
  expect(result.error).toBeUndefined();const session=decode(result.session);expect(session.businessId).toBe(t.id);expect(session.turns).toBe(++turns);
  await expect(page.getByText(result.reply,{exact:true}).last()).toBeVisible();
  const boundary={message,state:session.state,turns:session.turns,...modelEvidence.get(message),reply:result.reply,decision:result.turnDecision,validation:result.debug};
  // The existing isolated booking adapter records a simulated availability
  // read. It is not a booking write or a real provider call; all other effects
  // remain forbidden and actual database counts are checked separately.
  evidence.push({...boundary,externalActions:result.externalActions??[]});
  for(const action of result.externalActions??[])expect(action).toEqual({kind:'booking.availability',disposition:'SIMULATED',detail:'synthetic_hours'});
  return{...result,state:session.state,request,boundary};
};}
test('P1 individual/composite/partial recall after >10 turns, reload, correction and tenant denial',async({page,context})=>{
  test.setTimeout(180000);const t=tenant('information'),evidence=[];await login(page,context,t);const send=sender(page,t,evidence);
  await send('Cilat të dhëna të duhen?');
  let current=await send('Emri: Drita; Lloji i biznesit: Shitje librash online; Instagram: synthetic_books; Pyetjet tipike: çmimet dhe madhësitë');
  expect(current.state.pendingCustomerQuestion).toBeUndefined();
  for(let i=0;i<12;i++)current=await send(`Çfarë informacioni keni? ${i}`);
  expect(current.state.recentMessages).toHaveLength(10);expect(JSON.stringify(current.state.recentMessages)).not.toContain('synthetic_books');
  await page.reload();current=await send(composite);
  for(const value of Object.values(expected))expect(current.reply).toContain(value);
  expect(current.boundary.projection.reference.keys).toHaveLength(4);expect(current.state.pendingCustomerQuestion).toBeUndefined();
  rpcRoundtrip(t,current.state,current.reply);
  const individual=await send('Si quhem une?');expect(individual.reply).toContain(expected.name);
  expect(individual.boundary.projection.declared).toEqual({});
  current=await send('Më përmblidh saktë emrin, biznesin, Instagramin dhe pyetjet tipike.');expect(current.reply.replace(/\s+/g,' ')).toBe(correct);
  await send('Profili im në Instagram është corrected_books');current=await send(composite);
  expect(current.reply).toContain('corrected_books');expect(current.reply).not.toContain('synthetic_books');
  expect(current.state.customerDeclaredFacts.instagram_handle.value).toBe('corrected_books');
  const foreign=await page.request.post(current.request.url,{headers:current.request.headers,data:JSON.stringify([{slug:tenant('retail').slug,message:composite,session:current.session}])});
  expect(resultFromFlight(await foreign.text()).error).toBeTruthy();
  rpcRoundtrip(t,current.state,current.reply);expect(counts()).toBe(before);
  await test.info().attach('p1-boundaries',{body:Buffer.from(JSON.stringify({synthetic:true,realLLM:false,evidence})),contentType:'application/json'});
});
test('P1 partial availability preserves the known field through actual Agent Test',async({page,context})=>{
  test.setTimeout(90000);const t=tenant('information'),evidence=[];await login(page,context,t);const send=sender(page,t,evidence);
  await send('Quhem Drita');const result=await send('Më kujto emrin dhe Instagramin.');
  expect(result.reply).toContain('Drita');expect(result.reply).toContain('Instagram');expect(result.reply).not.toContain('synthetic_books');
  expect(result.boundary.projection.unavailable).toContainEqual({key:'instagram_handle',reason:'missing'});
  expect(result.state.customerDeclaredFacts?.instagram_handle).toBeUndefined();rpcRoundtrip(t,result.state,result.reply);
});
for(const kind of ['retail','quote','appointment'])test(`P1 ${kind}: actual process fields → composite recall → reload`,async({page,context})=>{
  test.setTimeout(150000);const t=tenant(kind),evidence=[];await login(page,context,t);const send=sender(page,t,evidence);
  let current;
  if(kind==='retail'){await send('Dua të porosis E2E Shirt');await send('L');current=await send('2');expect(current.state.context.order.size.value).toBe('L');}
  if(kind==='quote'){await send('Dua të vazhdoj me E2E Website');await send('Landing page');current=await send('750');expect(current.state.processes.service.order.budget.value).toBe('750');}
  // 10:00 is inside the fixture's configured hours; 18:00 is correctly rejected.
  if(kind==='appointment'){current=await send('Dua të rezervoj E2E Consultation më 2027-01-05 në 10:00');expect(current.state.processes.booking.draft).toMatchObject({date:'2027-01-05',time:'10:00',serviceId:t.entityId});}
  const message=kind==='retail'?'Më kujto preferencat për porosinë.':kind==='quote'?'Më kujto të dhënat për shërbimin.':'Më trego preferencat që kam dhënë për rezervimin.';
  const values=kind==='retail'?['L','2']:kind==='quote'?['Landing page','750']:['2027-01-05','10:00'];
  current=await send(message);for(const value of values)expect(current.reply).toContain(value);
  expect(current.boundary.projection.process).toBeDefined();expect(current.boundary.projection.profile).toEqual({});
  const id=current.boundary.projection.process.id,version=current.boundary.projection.process.versionId;
  await page.reload();current=await send(message);for(const value of values)expect(current.reply).toContain(value);
  expect(current.boundary.projection.process).toMatchObject({id,versionId:version});rpcRoundtrip(t,current.state,current.reply);
  if(kind==='appointment'){
    await send('Vazhdo rezervimin');await send('11:00');current=await send(message);
    expect(current.reply).toContain('11:00');expect(current.reply).not.toContain('10:00');
    expect(current.boundary.projection.process).toMatchObject({id,versionId:version});
  }
  expect(counts()).toBe(before);
  await test.info().attach('p1-process',{body:Buffer.from(JSON.stringify({synthetic:true,realLLM:false,kind,evidence})),contentType:'application/json'});
});
