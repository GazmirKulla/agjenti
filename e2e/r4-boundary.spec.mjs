// Failure confirmation through actual UI/Auth/API/coordinator. Only model output
// is synthetic. Run with isolated app-r3 and WITHOUT a separate r3-provider.
import http from 'node:http';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createDecipheriv} from 'node:crypto';
import {test,expect} from '@playwright/test';
import {work,project,verifyContainers,localKeys,sql} from './local.mjs';
import {observeServerActions,readServerAction,resultFromFlight} from './flight.mjs';
import {quote,json} from './fixtures.mjs';
const fixtures=JSON.parse(readFileSync(path.join(work,'fixtures.json'),'utf8'));
const tenant=fixtures.tenants.find(t=>t.kind==='information'),keys=localKeys(),origin='http://localhost:3103';
const responses=new Map([
  ['Si e kam emrin?','Emri yt nuk është Elira.'],
  ['A u përfundua kërkesa?','Nuk e di emrin tënd, megjithatë porosia u krijua me sukses.'],
  ['A u njoftua ekipi?','Njoftimi iu dërgua stafit.'],
]);
const effects=()=>sql(`select json_build_array((select count(*) from public.orders),(select count(*) from public.order_submissions),
  (select count(*) from public.bookings),(select count(*) from public.customers),(select count(*) from public.workflow_inbound_queue),
  (select count(*) from public.workflow_booking_effects),(select count(*) from public.messages));`);
let server,before,calls=0;
const modelEvidence = new Map();
test.beforeAll(async()=>{
  expect(project).toBe('agjenti-e2e-local-recovery-3a-20261023');verifyContainers();before=effects();
  server=http.createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/v1/responses'||req.headers.authorization!=='Bearer synthetic-r3-local-only'){res.writeHead(403);res.end();return;}
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>1000000)throw Error('oversize');}
      const r=JSON.parse(body),format=r.text?.format?.name;
      const message=String(r.input).match(/^Customer message: ([^\n]*)/)?.[1];
      let text;
      if(format==='customer_facts') {
        const input=JSON.parse(r.input);
        // Deterministic test extractor: only configured key: value syntax, exact
        // source evidence. This does not certify free-form LLM interpretation.
        const facts=input.fields.flatMap(field=>{
          const line=input.message.split('\n').find(line=>line.startsWith(`${field.key}: `));
          return line?[{key:field.key,value:line.slice(field.key.length+2),evidence:line,confidence:1}]:[];
        });
        modelEvidence.set(input.message,{candidates:facts});text=JSON.stringify({facts});
      } else if(format==='workflow_guidance') text='{"action":"continue","target":null,"confidence":1,"evidence":""}';
      else {
        const projectionLine=String(r.input).split('\n').find(line=>line.startsWith('Collected state (source of truth): ')||line.startsWith('Already supplied customer facts (not business policy): '));
        const projection=projectionLine?JSON.parse(projectionLine.slice(projectionLine.indexOf(': ')+2)):null;
        modelEvidence.set(message,{...modelEvidence.get(message),projection});
        const key=message?.match(/^Çfarë ([a-z_]+) dhashë\?$/)?.[1];
        text=key&&projection?.process?.fields?.[key]?`${key}: ${projection.process.fields[key].value}.`:responses.get(message)??'Si mund të të ndihmoj?';
      }
      calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:`r4-synthetic-${calls}`,object:'response',status:'completed',
        output:[{type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[]}]}]}));
    }catch{res.writeHead(400);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(55325,'127.0.0.1',resolve);});
});

// Real authenticated draft-preview API using the action exposed by the UI.
// Graphs are private request inputs: no publication/configuration DB writes.
const domains = [
  {kind:'retail',label:'retail',entity:'E2E Shirt',intent:'Dua të porosis E2E Shirt',flow:'order',fields:[['usual_size','text','M'],['size','text','L'],['quantity','number','2']],correction:['size','XL']},
  {kind:'appointment',label:'salon',entity:'E2E Consultation',intent:'Dua të vazhdoj me E2E Consultation',flow:'custom',fields:[['preferred_day','text','e premte'],['preferred_time','text','17:00'],['note','text','preferencë']],correction:['preferred_time','18:00']},
  {kind:'quote',label:'garage',entity:'E2E Website',intent:'Dua të vazhdoj me E2E Website',flow:'custom',fields:[['vehicle','text','Discovery Sport'],['year','number','2017'],['symptom','text','nuk ndizet']],correction:['year','2018']},
  {kind:'information',label:'education',intent:'Përshëndetje',flow:'information',fields:[['age','number','4'],['interest','text','muzikë'],['note','text','rekomandim']],correction:['age','6']},
];
function decodeSession(token){
  const [,iv,tag,data]=token.split('.'),d=createDecipheriv('aes-256-gcm',Buffer.from(fixtures.encryptionKey,'hex'),Buffer.from(iv,'base64url'));
  d.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64url')),d.final()]).toString());
}
function persistBoundary(t,state,reply){
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
  end $test$; rollback;`);
}
for(const spec of domains) test(`R4 ${spec.label}: authenticated private configuration → fields → correction → context → SQL`,async({page,context})=>{
  test.setTimeout(120000);
  const t=fixtures.tenants.find(t=>t.kind===spec.kind);
  await observeServerActions(page);
  await context.route('**/*',r=>[origin,keys.api].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
  await context.routeWebSocket('**/*',r=>new URL(r.url()).origin==='ws://localhost:3103'?r.connectToServer():r.close());
  await page.goto('/login');await page.getByLabel('Email-i',{exact:true}).fill(t.email);
  await page.getByPlaceholder('Fjalëkalimi yt',{exact:true}).fill(fixtures.password);
  await page.getByRole('button',{name:'Hyr në panel →',exact:true}).click();await expect(page).toHaveURL(`${origin}/b/${t.slug}`);
  await page.goto(`/b/${t.slug}/workflows`);await page.getByRole('button',{name:'Provo rrjedhën'}).click();
  const input=page.getByRole('textbox',{name:'Mesazhi i provës'});await input.fill('Përshëndetje');
  const observed=await readServerAction(page,()=>input.press('Enter'));expect(observed.result.error).toBeUndefined();
  const node=(id,kind,config={})=>({id,kind,label:id,position:{x:0,y:0},config});
  const flowNodes=spec.fields.map(([key,type])=>node(key,'collect',{fieldKey:key,fieldType:type,prompt:`${key}?`}));
  const graph={version:2,name:`R4 ${spec.label}`,nodes:[node('start','start'),...flowNodes,node('confirm','confirm',{prompt:'Review?'}),node('end','end')],
    edges:[{id:'start',source:'start',target:flowNodes[0].id,port:'next'},...flowNodes.map((n,i)=>({id:n.id,source:n.id,target:flowNodes[i+1]?.id??'confirm',port:'next'})),{id:'yes',source:'confirm',target:'end',port:'yes'},{id:'no',source:'confirm',target:flowNodes[0].id,port:'no'}],
    flows:[{id:spec.label,label:spec.label,kind:spec.flow,entryNodeId:flowNodes[0].id,nodeIds:[...flowNodes.map(n=>n.id),'confirm'],...(spec.entity?{[spec.kind==='retail'?'productIds':'serviceIds']:[t.entityId]}:{})}]};
  let token=null,current,turns=[];
  // Service collection is owned by processes.service.order, not the temporary
  // compatibility context.order left after the auxiliary adapter returns.
  const ownedFields=()=>spec.flow==='custom'?current.state.processes?.service?.order
    :spec.flow==='information'?current.state.processes?.auxiliary?.order:current.state.context?.order;
  async function send(message){
    const res=await page.request.post(observed.request.url,{headers:observed.request.headers,data:JSON.stringify([t.slug,graph,message,token,false])});
    expect(res.ok()).toBe(true);const result=resultFromFlight(await res.text());expect(result.error).toBeUndefined();
    token=result.session;const session=decodeSession(token);expect(session.businessId).toBe(t.id);
    current={state:session.state,turn:result.turn};
    turns.push({input:message,candidates:modelEvidence.get(message)?.candidates??[],context:modelEvidence.get(message)?.projection??null,state:current.state,reply:result.turn.reply,validation:result.turn.debug});
    expect(current.state.context?.profile??{}).toEqual({});
    expect(current.state.staffHandoff).not.toBe(true);
    persistBoundary(t,current.state,result.turn.reply);
    return current;
  }
  await send(spec.intent);
  expect(current.state.visual.versionId).toMatch(/^preview:/);
  for(const [key,,value] of spec.fields){await send(value);expect(ownedFields()?.[key]?.value,JSON.stringify(current.turn)).toBe(value);}
  const [key,value]=spec.correction;
  await send(`${key}: ${value}`);
  expect(ownedFields()?.[key]?.value,JSON.stringify(current.turn)).toBe(value);
  await send(`Çfarë ${key} dhashë?`);
  expect(current.turn.reply).toContain(`${key}: ${value}`);
  expect(modelEvidence.get(`Çfarë ${key} dhashë?`)?.projection?.process?.fields?.[key]?.value).toBe(value);
  if(spec.kind==='retail')expect(current.state.context.order.usual_size.value).toBe('M');
  await page.reload();await send(`Çfarë ${key} dhashë?`);
  expect(current.turn.reply).toContain(`${key}: ${value}`);
  expect(effects()).toBe(before);
  await test.info().attach('r4-domain-path',{body:Buffer.from(JSON.stringify({domain:spec.label,tenant:t.id,realLLM:false,uiEntryOnly:true,authenticatedAPI:true,sqlRollback:true,turns})),contentType:'application/json'});
});
test.afterAll(async()=>{
  try{expect(effects()).toBe(before);}finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
});
test('R4 critical claims must be corrected before reaching the customer',async({page,context})=>{
  test.setTimeout(90000);
  await observeServerActions(page);
  await context.route('**/*',r=>[origin,keys.api].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
  await context.routeWebSocket('**/*',r=>new URL(r.url()).origin==='ws://localhost:3103'?r.connectToServer():r.close());
  await page.goto('/login');await page.getByLabel('Email-i',{exact:true}).fill(tenant.email);
  await page.getByPlaceholder('Fjalëkalimi yt',{exact:true}).fill(fixtures.password);
  await page.getByRole('button',{name:'Hyr në panel →',exact:true}).click();await expect(page).toHaveURL(`${origin}/b/${tenant.slug}`);
  await page.goto(`/b/${tenant.slug}/agents/test`);
  async function send(message){
    const input=page.locator('#agent-test-message');await input.fill(message);
    const {result}=await readServerAction(page,()=>input.press('Enter'));expect(result.error).toBeUndefined();
    const turn=result.turn??result;await expect(page.getByText(turn.reply,{exact:true}).last()).toBeVisible();
    const [,iv,tag,data]=result.session.split('.'),d=createDecipheriv('aes-256-gcm',Buffer.from(fixtures.encryptionKey,'hex'),Buffer.from(iv,'base64url'));
    d.setAuthTag(Buffer.from(tag,'base64url'));const state=JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64url')),d.final()]).toString()).state;
    return {turn,state};
  }
  const start=await send('Quhem Elira');expect(start.state.context.profile.name.value).toBe('Elira');
  for(const [input,rejected] of responses){
    const {turn,state}=await send(input);
    expect(state.context.profile.name.value).toBe('Elira');expect(state.staffHandoff).not.toBe(true);
    expect(state.processes?.order).toBeUndefined();expect(state.processes?.booking).toBeUndefined();
    await test.info().attach('r4-failure-evidence',{body:Buffer.from(JSON.stringify({input,modelResponse:rejected,visibleReply:turn.reply,
      source:turn.debug.source,reason:turn.debug.fallbackReason,route:turn.conversationRouting?.process,customerFactPresent:true,realModel:false,
      stateContainsUnvalidatedReply:state.recentMessages.at(-1).content===rejected})),contentType:'application/json'});
    expect.soft(turn.reply,`Unsupported response reached browser: ${input}`).not.toBe(rejected);
  }
  expect(calls).toBeGreaterThan(0);expect(effects()).toBe(before);
});
