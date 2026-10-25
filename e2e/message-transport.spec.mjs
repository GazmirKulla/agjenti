// Actual browser → HTTP queue → SQL → coordinator/executor. Model only is synthetic.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createCipheriv,createHmac} from 'node:crypto';
import path from 'node:path';
import {test,expect} from '@playwright/test';
import {work,project,verifyContainers,localKeys,sql} from './local.mjs';
import {quote} from './fixtures.mjs';
const f=JSON.parse(readFileSync(path.join(work,'fixtures.json'),'utf8')),keys=localKeys(),origin='http://localhost:3103';
const t=f.tenants.find(t=>t.kind==='information');
const counts=()=>sql(`select json_build_array((select count(*) from public.orders),(select count(*) from public.bookings),(select count(*) from public.customers),(select count(*) from public.messages));`);
let server,before,slow=true;
const providerParts=[];
const providerReactions=[];
const generations=[];
const fragmentTexts=['pse','ti psh','mund ta kuptosh','cfare po t them','kur t shkruaj mesazhe','tek e tek','?'];
const continuationTexts=['po mundohem','te kuptoj','cfare po ndodh'];
test.beforeAll(async()=>{
 expect(project).toBe('agjenti-e2e-local-messages-20261024');verifyContainers();before=counts();
 server=http.createServer(async(req,res)=>{
  if(req.method==='POST'&&['/meta/instagram','/meta/whatsapp'].includes(req.url)&&req.headers.authorization==='Bearer synthetic-transport-local-only'){
   let raw='';for await(const p of req)raw+=p;const payload=JSON.parse(raw),text=payload.message?.text??payload.text?.body;
   if (payload.sender_action==='react' || payload.sender_action==='unreact' || payload.type==='reaction') {
    const reaction={id:`synthetic-reaction-${randomUUID()}`,target:payload.payload?.message_id??payload.reaction?.message_id,payload};
    providerReactions.push(reaction);res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(req.url.endsWith('instagram')?{recipient_id:payload.recipient.id}:{messages:[{id:reaction.id}]}));return;
   }
   const part={id:`synthetic-${randomUUID()}`,text,channel:req.url.split('/').at(-1)};providerParts.push(part);
   await new Promise(resolve=>setTimeout(resolve,1500));
   res.setHeader('Content-Type','application/json');
   if(text.includes('[synthetic-reject]') || text.includes('[synthetic-retry]') && providerParts.filter(p=>p.text===text&&p.channel===part.channel).length===1){res.writeHead(400);res.end(JSON.stringify({error:{code:100,message:'Synthetic rejection'}}));return;}
   res.end(JSON.stringify(part.channel==='instagram'?{message_id:part.id}:{messages:[{id:part.id}]}));return;
  }
  if(req.method!=='POST'||req.url!=='/v1/responses'||req.headers.authorization!=='Bearer synthetic-r3-local-only'){res.writeHead(403);res.end();return;}
  let body='';for await(const p of req)body+=p;
  const r=JSON.parse(body),format=r.text?.format?.name;
  let text;
  if(format==='customer_facts')text='{"facts":[]}';
  else if(format==='workflow_guidance')text='{"action":"continue","target":null,"confidence":1,"evidence":""}';
  else {
   const message=String(r.input).match(/^Customer message: ([\s\S]*?)(?=\n(?:Current step:|Already supplied customer facts \(not business policy\):))/)?.[1]??'';
   generations.push({message,input:String(r.input)});
   if(message===fragmentTexts.join('\n'))await new Promise(resolve=>setTimeout(resolve,8000));
   if(message==='Cilat të dhëna të duhen?'){
    // Leave time for lifecycle checks, but stay below the real 25s AI timeout.
    if(slow)await new Promise(resolve=>setTimeout(resolve,18000));
    text='[[ask_customer:name,business_type,instagram_handle,stated_needs]]';
   }else text=/kujto|quhem/i.test(message)?'Nuk e di emrin. Nuk më ke dhënë asnjë të dhënë.':'Informacion sintetik, pa veprime biznesi.';
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:`local-${randomUUID()}`,object:'response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[]}]}]}));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(55325,'127.0.0.1',resolve);});
});
function sealToken(){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.from(f.encryptionKey,'hex'),iv);const data=Buffer.concat([c.update('synthetic-transport-local-only'),c.final()]);return ['v1',iv.toString('base64url'),c.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');}
for (const channel of ['instagram','whatsapp']) test(`automatic ${channel} reaction: signed ingress, normal reply, reload, manual ownership and staff takeover`,async({page,context})=>{
 const conn=randomUUID(),cid=randomUUID(),external=`synthetic-in-${randomUUID()}`,account=channel==='whatsapp'?'999000000000001':`synthetic-transport-${randomUUID()}`,person=channel==='whatsapp'?'355000000000':`synthetic-person-${randomUUID()}`;
 const original=sql(`select ai_reactions_enabled from businesses where id=${quote(t.id)};`);
 sql(`begin; update businesses set ai_reactions_enabled=true where id=${quote(t.id)};
  ${channel==='instagram'?`insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values(${quote(conn)},${quote(t.id)},${quote(account)},${quote(sealToken())},'connected');`:`insert into whatsapp_connections(id,business_id,phone_number_id,waba_id,access_token_ciphertext,status) values(${quote(conn)},${quote(t.id)},${quote(account)},'synthetic-waba',${quote(sealToken())},'connected');`}
  insert into conversations(id,business_id,channel,${channel}_connection_id,${channel}_participant_id,last_inbound_at,status,auto_reply) values(${quote(cid)},${quote(t.id)},${quote(channel)},${quote(conn)},${quote(person)},now(),'active',true);commit;`);
 const post=(messageId=external)=>{
  const body=JSON.stringify(channel==='instagram'?{object:'instagram',entry:[{id:account,messaging:[{sender:{id:person},recipient:{id:account},timestamp:Date.now(),message:{mid:messageId,text:'Faleminderit'}}]}]}:
   {object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:account},messages:[{id:messageId,from:person,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Faleminderit'}}]}}]}]});
  return page.request.post('/api/webhooks/meta',{data:body,headers:{'Content-Type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256','synthetic-transport-webhook').update(body).digest('hex')}});
 };
 try {
  await login(page,context);expect((await post()).status()).toBe(200);expect((await post()).status()).toBe(200);
  await expect.poll(()=>sql(`select count(*) from workflow_inbound_queue where connection_id=${quote(conn)} and status='sent';`),{timeout:60000}).toBe('1');
  const diagnostics=sql(`select json_build_object('operations',(select json_agg(json_build_object('status',o.status,'error',o.error,'started',o.send_started_at)) from message_reaction_operations o join message_reactions r on r.id=o.reaction_id where r.connection_id=${quote(conn)}),'state',(select collected from conversation_states where conversation_id=${quote(cid)}));`);
  expect(providerReactions.filter(r=>r.target===external),diagnostics).toHaveLength(1);
  expect(sql(`select collected->>'conversationPaused' from conversation_states where conversation_id=${quote(cid)};`)).toBe('true');
  expect(sql(`select count(*) from messages where conversation_id=${quote(cid)};`)).toBe('2');
  await page.goto(`/b/${t.slug}/inbox/${cid}`);
  const customer=page.locator('.chat-message.inbound');
  await expect(customer.getByText('😊 · Biznesi',{exact:true})).toBeVisible();
  await expect(page.locator('.chat-message.outbound')).toHaveCount(1);
  await page.reload();await expect(customer.getByText('😊 · Biznesi',{exact:true})).toBeVisible();
  await page.screenshot({path:path.join(work,`automatic-reactions-${channel}-desktop.png`)});
  await page.setViewportSize({width:390,height:844});await customer.scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(work,`automatic-reactions-${channel}-mobile.png`)});
  await customer.getByRole('button',{name:'😊 · Biznesi',exact:true}).click();
  await customer.getByRole('button',{name:'Reago 👍',exact:true}).click();
  await expect(customer.getByText('👍 · Biznesi',{exact:true})).toBeVisible();
  expect((await post()).status()).toBe(200);
  expect(providerReactions.filter(r=>r.target===external)).toHaveLength(2); // one AI + one explicit human change
  expect(sql(`select count(*) from message_reaction_operations where business_id=${quote(t.id)} and actor_kind='ai' and reaction_id in(select id from message_reactions where connection_id=${quote(conn)});`)).toBe('1');
  await page.reload();await expect(customer.getByText('👍 · Biznesi',{exact:true})).toBeVisible();
  // Real UI/manual-reply ownership, not a fabricated conversationPaused flag.
  await page.getByLabel('Shkruaj një mesazh',{exact:true}).fill('Përgjigje sintetike nga stafi.');
  await page.getByRole('button',{name:'Dërgo',exact:true}).click();
  await expect.poll(()=>sql(`select count(*) from messages where conversation_id=${quote(cid)} and source='staff';`)).toBe('1');
  const pausedMessage=`synthetic-in-${randomUUID()}`;
  expect((await post(pausedMessage)).status()).toBe(200);
  await expect.poll(()=>sql(`select status from workflow_inbound_queue where connection_id=${quote(conn)} and external_id=${quote(pausedMessage)};`)).toBe('ignored');
  expect(providerReactions.filter(r=>r.target===pausedMessage)).toHaveLength(0);
  expect(sql(`select status='paused' and auto_reply=false from conversations where id=${quote(cid)};`)).toBe('t');
  expect(sql(`select count(*) from messages where conversation_id=${quote(cid)} and source='agent';`)).toBe('1');
  await page.reload();await expect(page.locator('.chat-message.inbound').first().getByText('👍 · Biznesi',{exact:true})).toBeVisible();
  await page.screenshot({path:path.join(work,`automatic-reactions-${channel}-manual-staff-mobile.png`)});
 } finally {
  sql(`begin;update businesses set ai_reactions_enabled=${original==='t'?'true':'false'} where id=${quote(t.id)};delete from workflow_inbound_queue where connection_id=${quote(conn)};delete from conversations where id=${quote(cid)};delete from ${channel}_connections where id=${quote(conn)};commit;`);
 }
});
test('Instagram signed ingress groups originals once and staff takeover suppresses the next generated reply',async({page,context})=>{
 test.setTimeout(180000);
 const conn=randomUUID(),cid=randomUUID(),account=`synthetic-transport-${randomUUID()}`,person=`synthetic-person-${randomUUID()}`;
 const token=sealToken(),start=providerParts.length;
 sql(`begin;insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values(${quote(conn)},${quote(t.id)},${quote(account)},${quote(token)},'connected');
 insert into conversations(id,business_id,channel,instagram_connection_id,instagram_participant_id,last_inbound_at,status,auto_reply) values(${quote(cid)},${quote(t.id)},'instagram',${quote(conn)},${quote(person)},now(),'active',true);commit;`);
 const events=texts=>texts.map(text=>({sender:{id:person},recipient:{id:account},timestamp:Date.now(),message:{mid:`synthetic-${randomUUID()}`,text}}));
 const post=async messaging=>{
  const body=JSON.stringify({object:'instagram',entry:[{id:account,messaging}]});
  return page.request.post('/api/webhooks/meta',{data:body,headers:{'Content-Type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256','synthetic-transport-webhook').update(body).digest('hex')}});
 };
 try {
  await login(page,context);
  const first=events(fragmentTexts);
  expect((await post(first)).status()).toBe(200);
  expect((await post(first)).status()).toBe(200); // duplicate webhook, same raw IDs
  await expect.poll(()=>providerParts.length,{timeout:60000}).toBe(start+1);
  await expect.poll(()=>sql(`select count(*) from workflow_inbound_queue where connection_id=${quote(conn)} and status='sent';`),{timeout:30000}).toBe('1');
  const saved=JSON.parse(sql(`select json_agg(json_build_object('body',body,'external',external_message_id) order by created_at) from messages where conversation_id=${quote(cid)} and direction='inbound';`));
  expect(saved.map(m=>m.body)).toEqual(fragmentTexts);
  expect(saved.map(m=>m.external)).toEqual(first.map(e=>e.message.mid));
  expect(sql(`select count(*) from workflow_inbound_queue where connection_id=${quote(conn)};`)).toBe('7');
  const second=events(fragmentTexts),generationStart=generations.length;
  expect((await post(second)).status()).toBe(200);
  await expect.poll(()=>generations.slice(generationStart).map(g=>g.message),{timeout:30000}).toContain(fragmentTexts.join('\n'));
  // Real existing ownership service/RPC, not a mocked boolean guard.
  const takeover=await page.request.post(`/api/businesses/${t.id}/conversations/${cid}/messages`,{data:{requestId:randomUUID(),body:'Përgjigje sintetike nga stafi.'}});
  expect(takeover.status()).toBe(202);
  await expect.poll(()=>sql(`select count(*) from workflow_inbound_queue where connection_id=${quote(conn)} and status='ignored';`),{timeout:30000}).toBe('1');
  await expect.poll(()=>providerParts.length,{timeout:30000}).toBe(start+2);
  expect(providerParts.at(-1).text).toBe('Përgjigje sintetike nga stafi.');
  expect(sql(`select count(*) from messages where conversation_id=${quote(cid)} and source='agent';`)).toBe('1');
 } finally {
  sql(`begin;delete from workflow_inbound_queue where connection_id=${quote(conn)};delete from conversations where id=${quote(cid)};delete from instagram_connections where id=${quote(conn)};commit;`);
 }
});
for(const channel of ['instagram','whatsapp'])test(`Inbox ${channel}: three sends, reload, signed receipts, multipart and partial failure`,async({page,context})=>{
 test.setTimeout(240000); // Each independent SQL observation traverses the isolated Docker socket.
 const conn=randomUUID(),cid=randomUUID(),account=`synthetic-transport-${randomUUID()}`,person=`synthetic-person-${randomUUID()}`;
 const token=sealToken(),start=providerParts.length;
 sql(`begin;
  ${channel==='instagram'?`insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values(${quote(conn)},${quote(t.id)},${quote(account)},${quote(token)},'connected');`:`insert into whatsapp_connections(id,business_id,phone_number_id,waba_id,access_token_ciphertext,status) values(${quote(conn)},${quote(t.id)},${quote(account)},'synthetic-waba',${quote(token)},'connected');`}
  insert into conversations(id,business_id,channel,${channel}_connection_id,${channel}_participant_id,last_inbound_at,status,auto_reply) values(${quote(cid)},${quote(t.id)},${quote(channel)},${quote(conn)},${quote(person)},now(),'active',true);commit;`);
 try {
  await login(page,context);await page.goto(`/b/${t.slug}/inbox/${cid}`);
  const submit=async text=>{await page.getByLabel('Shkruaj një mesazh',{exact:true}).fill(text);await page.getByRole('button',{name:'Dërgo',exact:true}).click();};
  const first=channel==='instagram'?'part '.repeat(650):'First synthetic message';
  await submit(first);await expect.poll(()=>providerParts.length,{timeout:45000}).toBeGreaterThan(start);
  await submit('Second synthetic message');await submit('Third synthetic message');await page.reload();
  await expect.poll(()=>sql(`select count(*) from workflow_inbound_queue where conversation_id=${quote(cid)} and status='sent';`),{timeout:60000}).toBe('3');
  const messages=JSON.parse(sql(`select json_agg(json_build_object('id',id,'body',body,'status',delivery_status) order by created_at) from messages where conversation_id=${quote(cid)};`));
  expect(messages.map(m=>m.body)).toEqual([first.trim(),'Second synthetic message','Third synthetic message']);
  expect(messages.map(m=>m.status)).toEqual(['sent','sent','sent']);
  const parts=JSON.parse(sql(`select json_agg(json_build_object('external',external_message_id,'index',part_index) order by part_index) from message_transport_parts where message_id=${quote(messages[0].id)};`));
  if(channel==='instagram')expect(parts.length).toBeGreaterThan(1);else expect(parts).toHaveLength(1);
  const receipt=async(id,status,valid=true)=>{
   const body=JSON.stringify(channel==='instagram'?{object:'instagram',entry:[{id:account,messaging:[{sender:{id:person},recipient:{id:account},timestamp:Date.now(),read:{mid:id}}]}]}:{object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:account},statuses:[{id,recipient_id:person,status,timestamp:String(Math.floor(Date.now()/1000))}]}}]}]});
   return page.request.post('/api/webhooks/meta',{data:body,headers:{'Content-Type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',valid?'synthetic-transport-webhook':'invalid').update(body).digest('hex')}});
  };
  expect((await receipt(parts[0].external,'read',false)).status()).toBe(401);
  expect((await receipt(parts[0].external,'read')).status()).toBe(200);
  if(parts.length>1)expect(sql(`select delivery_status from messages where id=${quote(messages[0].id)};`)).toBe('sent');
  for(const part of parts){expect((await receipt(part.external,'read')).status()).toBe(200);expect((await receipt(part.external,channel==='whatsapp'?'delivered':'read')).status()).toBe(200);}
  expect(sql(`select delivery_status from messages where id=${quote(messages[0].id)};`)).toBe('read');
  await expect.poll(async()=>await page.locator('.chat-message small').allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(/Lexuar|read/i)]));
  const rejected=`[synthetic-retry] ${cid}`;
  await submit(rejected);
  await expect(page.getByRole('button',{name:'Provo përsëri të njëjtin dërgim',exact:true})).toBeVisible({timeout:45000});
  const original=JSON.parse(sql(`select json_build_object('id',m.id,'request',m.transport_request_id,'job',q.id,'attempts',q.attempts) from messages m join workflow_inbound_queue q on q.client_request_id=m.transport_request_id where m.conversation_id=${quote(cid)} and m.body=${quote(rejected)};`));
  await page.getByRole('button',{name:'Provo përsëri të njëjtin dërgim',exact:true}).click();
  await expect.poll(()=>sql(`select delivery_status from messages where id=${quote(original.id)};`),{timeout:45000}).toBe('sent');
  expect(sql(`select count(*) from messages where conversation_id=${quote(cid)} and body=${quote(rejected)};`)).toBe('1');
  const duplicate=await page.request.post(`/api/businesses/${t.id}/conversations/${cid}/messages`,{data:{requestId:original.request,body:rejected,retryAttempt:original.attempts}});expect(duplicate.status()).toBe(202);
  await page.waitForTimeout(1000);expect(providerParts.filter(p=>p.text===rejected)).toHaveLength(2);
  if(channel==='instagram'){
   await submit('safe '.repeat(450)+'[synthetic-reject]');
   await expect.poll(()=>sql(`select count(*) from workflow_inbound_queue where conversation_id=${quote(cid)} and status='uncertain';`),{timeout:45000}).toBe('1');
   const partial=JSON.parse(sql(`select json_agg(json_build_object('status',status,'external',external_message_id) order by part_index) from message_transport_parts where job_id=(select max(id) from workflow_inbound_queue where conversation_id=${quote(cid)});`));
   expect(partial[0].status).toBe('sent');expect(partial[0].external).toBeTruthy();expect(partial.at(-1).status).toBe('failed');
   const outbox=await (await page.request.get(`/api/businesses/${t.id}/conversations/${cid}/messages`)).json();
   const unsafe=outbox.jobs.find(j=>j.status==='uncertain');expect(unsafe.canRetry).toBe(false);
   const refused=await page.request.post(`/api/businesses/${t.id}/conversations/${cid}/messages`,{data:{requestId:unsafe.requestId,body:unsafe.body,retryAttempt:unsafe.attempts}});expect(refused.status()).toBe(409);
   const calls=providerParts.length;await page.reload();await page.waitForTimeout(2500);expect(providerParts.length).toBe(calls);
  }
  expect(sql(`select auto_reply from conversations where id=${quote(cid)};`)).toBe('f');
 } finally {
  sql(`begin;delete from workflow_inbound_queue where connection_id=${quote(conn)};delete from conversations where id=${quote(cid)};delete from ${channel}_connections where id=${quote(conn)};commit;`);
 }
});
test.afterAll(async()=>{try{expect(counts()).toBe(before);}finally{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));}});
async function login(page,context){
 await context.route('**/*',r=>[origin,keys.api].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
 await context.routeWebSocket('**/*',r=>new URL(r.url()).origin==='ws://localhost:3103'?r.connectToServer():r.close());
 await page.goto('/login');await page.getByLabel('Email-i',{exact:true}).fill(t.email);await page.getByPlaceholder('Fjalëkalimi yt',{exact:true}).fill(f.password);
 await page.getByRole('button',{name:'Hyr në panel →',exact:true}).click();await expect(page).toHaveURL(`${origin}/b/${t.slug}`);await page.goto(`/b/${t.slug}/agents/test`);
}
const history=page=>page.evaluate(({user,slug})=>JSON.parse(sessionStorage.getItem(`agjenti:test-chat:v1:${user}:${slug}`)??'[]'),{user:t.userId,slug:t.slug});
async function send(page,text){const input=page.locator('#agent-test-message');await expect(input).toBeEnabled();await input.fill(text);await page.getByRole('button',{name:'Dërgo mesazhin',exact:true}).click();await expect(input).toHaveValue('');}
test('exact rapid fragments freeze once, new burst during generation waits, reload preserves IDs and one reply per group',async({page,context})=>{
 test.setTimeout(180000);
 await login(page,context);const start=generations.length;
 for(const text of fragmentTexts)await send(page,text);
 const pending=(await history(page))[0],ids=pending.outbox.map(o=>o.id);
 expect(ids).toHaveLength(7);
 await expect.poll(()=>generations.slice(start).map(g=>g.message),{timeout:45000}).toContain(fragmentTexts.join('\n'));
 await expect(page.locator('.chat-typing')).toHaveCount(1);
 for(const text of continuationTexts)await send(page,text);
 const allIds=(await history(page))[0].outbox.map(o=>o.id);
 await page.getByRole('button',{name:'Ndalo pritjen',exact:true}).click();
 await expect(page.locator('.chat-typing')).toHaveCount(0);
 await page.reload();
 await expect.poll(async()=>((await history(page))[0]?.entries??[]).length,{timeout:60000}).toBe(10);
 const completed=(await history(page))[0];
 expect(completed.entries.map(e=>e.id)).toEqual(allIds);
 expect(completed.entries.map(e=>e.text)).toEqual([...fragmentTexts,...continuationTexts]);
 expect(completed.entries.at(-1).result.turns).toBe(10);
 const calls=generations.slice(start);
 expect(calls.map(g=>g.message)).toEqual([fragmentTexts.join('\n'),continuationTexts.join('\n')]);
 expect(calls[1].input).toContain(JSON.stringify(fragmentTexts.join('\n')));
 await expect(page.locator('.agent-test-bubble.customer')).toHaveCount(10);
 await expect(page.locator('.agent-test-bubble.agent')).toHaveCount(2);
 await expect(page.locator('.chat-typing')).toHaveCount(0);
 await page.screenshot({path:path.join(work,'fragment-batch-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Dërgo mesazhin',exact:true}).scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:path.join(work,'fragment-batch-mobile.png')});
 await send(page,'Sa kushton produkti?');
 await expect.poll(async()=>((await history(page))[0]?.entries??[]).length,{timeout:30000}).toBe(11);
 expect((await history(page))[0].entries[10].batchId).toBeUndefined();
 // Editing/regeneration replays from before a whole group, not from its final state.
 await page.getByRole('button',{name:'Ndrysho mesazhin',exact:true}).nth(8).click();
 await expect(page.locator('#agent-test-message')).toHaveValue(continuationTexts.join('\n'));
 await expect(page.getByText('Po ndryshon grupin e 3 mesazheve.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Anulo ndryshimin',exact:true}).click();
 expect(counts()).toBe(before);
});
test('three rapid messages → stop waiting → reload → ordered P0/P1/R4 recall, no customer writes',async({page,context})=>{
 await login(page,context);
 await send(page,'Cilat të dhëna të duhen?');
 await expect(page.getByRole('status',{name:'Agjenti po përpunon përgjigjen'})).toBeVisible({timeout:45000});
 await expect(page.locator('.chat-typing i')).toHaveCount(3);
 const stream=(await history(page))[0].id;
 const realJobs=await (await page.request.get(`/api/agent-test/turns?slug=${t.slug}&stream=${stream}`)).json();
 expect(realJobs.jobs[0].status).toBe('processing');
 // No Playwright auto-wait masking a composer blocked until generation ends.
 const activeComposer=page.locator('#agent-test-message');
 await expect(activeComposer).toBeEnabled({timeout:500});
 await activeComposer.fill('Drita\nShitje librash online\nsynthetic_books\nçmimet dhe madhësitë');
 await expect(page.getByRole('button',{name:'Dërgo mesazhin',exact:true})).toBeEnabled({timeout:500});
 expect((await history(page))[0].entries).toHaveLength(0);
 expect(await page.locator('.chat-typing i').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('chat-typing-dot');
 await page.screenshot({path:path.join(work,'messaging-ux-processing-desktop.png')});
 await activeComposer.press('Enter');
 await expect(activeComposer).toHaveValue('');
 expect((await history(page))[0].outbox).toHaveLength(2);
 await page.setViewportSize({width:390,height:844});
 await send(page,'Rikujto emrin, biznesin, Instagramin dhe pyetjet tipike.');
 await expect(page.locator('.chat-typing')).toBeVisible();
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await page.locator('.chat-typing i').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await page.screenshot({path:path.join(work,'messaging-ux-processing-mobile.png')});
 const pending=(await history(page))[0];expect(pending.outbox).toHaveLength(3);const ids=pending.outbox.map(o=>o.id);
 await page.getByRole('button',{name:'Ndalo pritjen',exact:true}).click();
 await expect(page.locator('.chat-typing')).toHaveCount(0);
 await expect(page.getByText('U ndal vetëm pritja këtu.',{exact:false})).toBeVisible();
 await expect(page.getByText('Duke pritur përgjigjen e AI-së…',{exact:true})).toHaveCount(0);
 await page.route('**/api/agent-test/turns?*',route=>route.request().method()==='GET'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic status timeout'})}):route.continue());
 await page.reload();await expect(page.locator('#agent-test-message')).toBeEnabled();
 await expect(page.getByText('Nuk po konfirmojmë dot statusin.',{exact:false})).toBeVisible();
 // Persisted processing must not masquerade as a fresh observation after reload.
 await expect(page.locator('.chat-typing')).toHaveCount(0);
 expect((await history(page))[0].outbox.map(o=>o.id)).toEqual(ids);
 await page.unroute('**/api/agent-test/turns?*');
 await expect(page.locator('.chat-typing')).toBeVisible();
 await expect.poll(async()=>((await history(page))[0]?.entries??[]).length,{timeout:90000}).toBe(3);
 let saved=(await history(page))[0];expect(saved.entries.map(e=>e.id)).toEqual(ids);expect(saved.outbox).toHaveLength(0);
 const last=saved.entries.at(-1).result;
 for(const value of ['Drita','Shitje librash online','synthetic_books','çmimet dhe madhësitë'])expect(last.reply).toContain(value);
 expect(last.nextState.pendingCustomerQuestion).toBeUndefined();expect(last.turns).toBe(3);
 expect(last.nextState.customerDeclaredFacts.instagram_handle.value).toBe('synthetic_books');
 const jobs=JSON.parse(sql(`select json_agg(json_build_object('id',client_request_id,'sequence',client_sequence,'status',status) order by client_sequence) from public.workflow_inbound_queue where test_stream_id=${quote(pending.id)};`));
 expect(jobs.map(j=>j.id)).toEqual(ids);expect(jobs.map(j=>j.status)).toEqual(['sent','sent','sent']);
 await expect(page.getByText('Duke pritur përgjigjen e AI-së…',{exact:true})).toHaveCount(0);
 await expect(page.locator('.chat-typing')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Ndalo pritjen',exact:true})).toHaveCount(0);
 await expect(page.getByText('Nuk po konfirmojmë dot statusin.',{exact:false})).toHaveCount(0);
 // Completed turns do not repeat a technical receipt; the reply itself is the
 // authoritative visual completion signal.
 expect(await page.locator('.chat-receipt').allTextContents()).toEqual([]);
 await page.setViewportSize({width:1280,height:900});
 for(let i=0;i<11;i++){await send(page,`Informacion tjetër ${i}`);await expect.poll(async()=>((await history(page))[0]?.entries??[]).length).toBe(4+i);}
 await page.reload();await send(page,'Më kujto emrin, biznesin, Instagramin dhe pyetjet tipike.');
 await expect.poll(async()=>((await history(page))[0]?.entries??[]).length).toBe(15);
 saved=(await history(page))[0];expect(saved.entries.at(-1).result.reply).toContain('synthetic_books');
 expect(saved.entries.at(-1).result.nextState.recentMessages).toHaveLength(10);
 await page.screenshot({path:path.join(work,'transport-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(work,'transport-mobile.png')});
 expect(counts()).toBe(before);
});
test('lost POST response reconciles one identity, explicit failed enqueue retry, tenant denial',async({page,context})=>{
 slow=false;await login(page,context);let lost=true,denied=true;
 await page.route('**/api/agent-test/turns?*',async route=>{
  if(route.request().method()==='POST'&&lost){lost=false;await route.fetch();await route.abort('timedout');return;}
  await route.continue();
 });
 await send(page,'Quhem Drita');await expect.poll(async()=>((await history(page))[0]?.entries??[]).length,{timeout:45000}).toBe(1);
 const chat=(await history(page))[0];expect(sql(`select count(*) from public.workflow_inbound_queue where test_stream_id=${quote(chat.id)};`)).toBe('1');
 await page.unroute('**/api/agent-test/turns?*');
 await page.route('**/api/agent-test/turns?*',async route=>{
  if(route.request().method()==='POST'&&denied){denied=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic temporary failure'})});return;}
  await route.continue();
 });
 await send(page,'Si quhem une?');await expect(page.getByRole('button',{name:'Provo përsëri të njëjtën kërkesë',exact:true})).toBeVisible();
 await expect(page.locator('.chat-typing')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Ndalo pritjen',exact:true})).toHaveCount(0);
 await expect(page.getByText('Synthetic temporary failure',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Rrjedha',exact:true}).click();
 await expect(page.getByLabel('Detajet e provës')).toContainText('Synthetic temporary failure');
 await page.getByRole('button',{name:'Rrjedha',exact:true}).click();
 await expect(page.getByRole('button',{name:'Bisedë e re',exact:true})).toBeEnabled();
 const id=(await history(page))[0].outbox[0].id;
 await send(page,'Më kujto emrin.');
 await page.waitForTimeout(2200); // More than two polling intervals: must not bypass the failed first enqueue.
 expect(sql(`select count(*) from public.workflow_inbound_queue where test_stream_id=${quote(chat.id)};`)).toBe('1');
 await page.getByRole('button',{name:'Provo përsëri të njëjtën kërkesë',exact:true}).click();
 await expect.poll(async()=>((await history(page))[0]?.entries??[]).length,{timeout:45000}).toBe(3);
 expect((await history(page))[0].entries[1].id).toBe(id);expect((await history(page))[0].entries[1].result.reply).toContain('Drita');
 const foreign=f.tenants[0];const deniedResponse=await page.request.get(`/api/agent-test/turns?slug=${foreign.slug}&stream=${chat.id}`);expect(deniedResponse.status()).toBe(403);
 expect(sql(`select count(*) from public.workflow_inbound_queue where test_stream_id=${quote(chat.id)};`)).toBe('3');
});
