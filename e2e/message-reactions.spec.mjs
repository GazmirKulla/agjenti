// Actual UI/API/Auth/RLS; Meta is a strict loopback synthetic provider.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createCipheriv,createHmac} from 'node:crypto';
import path from 'node:path';
import {test,expect} from '@playwright/test';
import {work,project,verifyContainers,localKeys,sql} from './local.mjs';
import {quote} from './fixtures.mjs';
const f=JSON.parse(readFileSync(path.join(work,'fixtures.json'),'utf8')),keys=localKeys(),origin='http://localhost:3103',tenant=f.tenants.find(t=>t.kind==='information');
const calls=[];let server;
test.beforeAll(async()=>{
 expect(project).toBe('agjenti-e2e-local-messages-20261024');verifyContainers();
 server=http.createServer(async(req,res)=>{
  if(req.method!=='POST'||!['/meta/instagram','/meta/whatsapp'].includes(req.url)||req.headers.authorization!=='Bearer synthetic-transport-local-only'){res.writeHead(403);res.end();return;}
  let raw='';for await(const x of req)raw+=x;const p=JSON.parse(raw),channel=req.url.split('/').at(-1),emoji=p.sender_action==='unreact'?'':p.payload?.reaction??p.reaction?.emoji;
  if(p.message||p.text||!['react','unreact'].includes(p.sender_action)&&p.type!=='reaction'){res.writeHead(400);res.end();return;}
  const call={channel,emoji,target:p.payload?.message_id??p.reaction?.message_id,payload:p,id:`synthetic-reaction-${randomUUID()}`};calls.push(call);
  await new Promise(r=>setTimeout(r,emoji==='love'||emoji==='❤️'?3000:1200));
  if(emoji==='🙏'){req.socket.destroy();return;}
  res.setHeader('Content-Type','application/json');
  if(emoji==='😂'&&calls.filter(c=>c.target===call.target&&c.emoji===emoji).length===1){res.writeHead(400);res.end(JSON.stringify({error:{code:100,message:'Synthetic definite rejection'}}));return;}
  res.end(JSON.stringify(channel==='instagram'?{recipient_id:p.recipient.id}:{messages:[{id:call.id}]}));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(55325,'127.0.0.1',resolve);});
});
test.afterAll(async()=>{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));});
function token(){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.from(f.encryptionKey,'hex'),iv);const data=Buffer.concat([c.update('synthetic-transport-local-only'),c.final()]);return ['v1',iv.toString('base64url'),c.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');}
async function login(page,context){
 await context.route('**/*',r=>[origin,keys.api].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
 await context.routeWebSocket('**/*',r=>new URL(r.url()).origin==='ws://localhost:3103'?r.connectToServer():r.close());
 await page.goto('/login');await page.getByLabel('Email-i',{exact:true}).fill(tenant.email);await page.getByPlaceholder('Fjalëkalimi yt',{exact:true}).fill(f.password);
 await page.getByRole('button',{name:'Hyr në panel →',exact:true}).click();await expect(page).toHaveURL(`${origin}/b/${tenant.slug}`);
}
async function signed(page,payload,valid=true){const body=JSON.stringify(payload);return page.request.post('/api/webhooks/meta',{data:body,headers:{'Content-Type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',valid?'synthetic-transport-webhook':'invalid').update(body).digest('hex')}});}
for(const channel of ['instagram','whatsapp'])test(`${channel}: manual reactions, incoming events, reload, retry, isolation and keyboard/mobile`,async({page,context})=>{
 const conn=randomUUID(),cid=randomUUID(),mid=randomUUID(),out=randomUUID(),external=`target-${randomUUID()}`,outExternal=`out-${randomUUID()}`,account=`synthetic-transport-${randomUUID()}`,person=`synthetic-person-${randomUUID()}`;
 const endpoint=`/api/businesses/${tenant.id}/conversations/${cid}/reactions`;
 sql(`begin;
  ${channel==='instagram'?`insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values(${quote(conn)},${quote(tenant.id)},${quote(account)},${quote(token())},'connected');`:`insert into whatsapp_connections(id,business_id,phone_number_id,waba_id,access_token_ciphertext,status) values(${quote(conn)},${quote(tenant.id)},${quote(account)},'synthetic',${quote(token())},'connected');`}
  insert into conversations(id,business_id,channel,${channel}_connection_id,${channel}_participant_id,last_inbound_at,status,auto_reply) values(${quote(cid)},${quote(tenant.id)},${quote(channel)},${quote(conn)},${quote(person)},now(),'active',true);
  insert into messages(id,business_id,conversation_id,${channel}_connection_id,external_message_id,direction,source,body) values(${quote(mid)},${quote(tenant.id)},${quote(cid)},${quote(conn)},${quote(external)},'inbound','customer','Synthetic customer message'),(${quote(out)},${quote(tenant.id)},${quote(cid)},${quote(conn)},${quote(outExternal)},'outbound','staff','Synthetic business message');commit;`);
 const state=()=>sql(`select json_build_array((select count(*) from messages where conversation_id=${quote(cid)}),(select count(*) from workflow_inbound_queue where conversation_id=${quote(cid)}),(select count(*) from conversation_states where conversation_id=${quote(cid)}),(select auto_reply from conversations where id=${quote(cid)}));`),before=state();
 try {
  if(channel==='instagram')await context.addInitScript(()=>localStorage.setItem('agjenti-theme','dark'));
  await login(page,context);await page.goto(`/b/${tenant.slug}/inbox/${cid}`);
  const customer=page.locator('.chat-message.inbound'),business=page.locator('.chat-message.outbound');
  const choose=async emoji=>{await customer.getByLabel('Reago ndaj mesazhit',{exact:true}).click();await customer.getByRole('button',{name:`Reago ${emoji}`,exact:true}).click();};
  await customer.getByLabel('Reago ndaj mesazhit',{exact:true}).focus();await page.keyboard.press('Enter');await expect(customer.getByRole('group',{name:'Zgjidh reaction e biznesit'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(customer.locator('details[open]')).toHaveCount(0);await expect(customer.getByLabel('Reago ndaj mesazhit',{exact:true})).toBeFocused();
  await customer.getByLabel('Reago ndaj mesazhit',{exact:true}).click();await business.getByText('Synthetic business message',{exact:true}).click();await expect(customer.locator('details[open]')).toHaveCount(0);
  await choose('❤️');await expect(customer.getByText('Reaction po dërgohet…',{exact:true})).toBeVisible();
  await expect.poll(()=>calls.filter(c=>c.target===external).length).toBe(1);
  await page.reload(); // Abandon the HTTP response, then reconcile the durable operation without resending.
  await expect(customer.getByText('❤️ · Biznesi',{exact:true})).toBeVisible({timeout:45000});
  const first=calls.filter(c=>c.target===external);expect(first).toHaveLength(1);expect(first[0].payload.message??first[0].payload.text).toBeUndefined();
  await page.reload();await expect(customer.getByText('❤️ · Biznesi',{exact:true})).toBeVisible();
  // Another tab/operator sees the same business identity rather than a new reaction.
  const second=await context.newPage();await second.goto(`/b/${tenant.slug}/inbox/${cid}`);await expect(second.getByText('❤️ · Biznesi',{exact:true})).toBeVisible();
  await customer.getByRole('button',{name:'❤️ · Biznesi',exact:true}).click();
  await customer.getByRole('button',{name:'Reago 👍',exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(customer.getByText('👍 · Biznesi',{exact:true})).toBeVisible();await expect(second.getByText('👍 · Biznesi',{exact:true})).toBeVisible();await second.close();
  if(channel==='instagram'){
   await customer.getByLabel('Reago ndaj mesazhit',{exact:true}).click();await customer.getByRole('button',{name:'Hiq reaction',exact:true}).click();await expect(customer.getByText('Reaction u hoq.',{exact:true})).toBeVisible();
  } else {
   await customer.getByLabel('Reago ndaj mesazhit',{exact:true}).click();await expect(customer.getByRole('button',{name:'Hiq reaction',exact:true})).toBeDisabled();await page.keyboard.press('Escape');
  }
  const incoming=(emoji,time=Date.now()-10000,sender=person)=>channel==='instagram'?{object:'instagram',entry:[{id:account,messaging:[{sender:{id:sender},recipient:{id:account},timestamp:time,reaction:{mid:outExternal,action:emoji?'react':'unreact',...(emoji?{emoji}:{})}}]}]}
   :{object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:account},messages:[{id:`event-${time}`,from:sender,timestamp:Math.floor(time/1000),type:'reaction',reaction:{message_id:outExternal,...(emoji?{emoji}:{})}}]}}]}]};
  const stamp=Date.now()-10000;
  expect((await signed(page,incoming('👍',stamp),false)).status()).toBe(401);
  for(const payload of [incoming('👍',stamp),incoming('👍',stamp),incoming('❤️',stamp+3000),incoming('',stamp+1000)])expect((await signed(page,payload)).status()).toBe(200);
  await expect(business.getByText('❤️ · Klienti',{exact:true})).toBeVisible();await expect(business.getByLabel('Reago ndaj mesazhit',{exact:true})).toHaveCount(0);
  expect((await signed(page,incoming('',stamp+4000))).status()).toBe(200);await expect(business.getByText('❤️ · Klienti',{exact:true})).toHaveCount(0);
  expect((await signed(page,incoming('😊',stamp+5000))).status()).toBe(200);await expect(business.getByText('😊 · Klienti',{exact:true})).toBeVisible();
  await choose('😂');await expect(customer.getByText('Reaction dështoi.',{exact:true})).toBeVisible();
  const failed=(await (await page.request.get(endpoint)).json()).reactions.find(r=>r.actor==='business');
  await customer.getByRole('button',{name:'Riprovo të njëjtin reaction',exact:true}).click();await expect(customer.getByText('😂 · Biznesi',{exact:true})).toBeVisible();
  expect((await page.request.post(endpoint,{data:{messageId:mid,requestId:failed.requestId,revision:failed.revision,emoji:'😂',retryAttempt:failed.attempt}})).status()).toBe(200);
  expect(calls.filter(c=>c.target===external&&c.emoji==='😂')).toHaveLength(2);
  if(channel==='whatsapp'){
   const ack=calls.filter(c=>c.target===external&&c.emoji==='😂').at(-1).id;
   for(const status of ['failed','sent','failed'])expect((await signed(page,{object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:account},statuses:[{id:ack,recipient_id:person,status,timestamp:String(Math.floor(Date.now()/1000))}]}}]}]})).status()).toBe(200);
   await expect(customer.getByText('Reaction dështoi.',{exact:true})).toBeVisible();
   await expect(customer.getByText('👍 · Biznesi',{exact:true})).toBeVisible();
   await expect(customer.getByRole('button',{name:'Riprovo të njëjtin reaction',exact:true})).toHaveCount(0);
  }
  const forbidden=f.tenants.find(x=>x.id!==tenant.id);
  expect((await page.request.post(`/api/businesses/${forbidden.id}/conversations/${cid}/reactions`,{data:{messageId:mid,requestId:randomUUID(),revision:0,emoji:'👍'}})).status()).toBe(403);
  expect((await page.request.post(endpoint,{data:{messageId:out,requestId:randomUUID(),revision:0,emoji:'👍'}})).status()).toBe(409);
  await page.setViewportSize({width:390,height:844});await customer.getByLabel('Reago ndaj mesazhit',{exact:true}).click();await customer.getByRole('group',{name:'Zgjidh reaction e biznesit'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(work,`reactions-${channel}-mobile.png`),animations:'disabled'});await page.keyboard.press('Escape');
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(work,`reactions-${channel}-desktop.png`),animations:'disabled'});
  await choose('🙏');await expect(customer.getByText('Rezultati i reaction nuk dihet; nuk ridërgohet.',{exact:true})).toBeVisible();
  const count=calls.filter(c=>c.target===external).length;await page.reload();await expect(customer.getByText('Rezultati i reaction nuk dihet; nuk ridërgohet.',{exact:true})).toBeVisible();
  await customer.getByRole('button',{name:/· Biznesi$/}).focus();await page.keyboard.press('Enter');
  await expect(customer.locator('details[open]')).toHaveCount(1);await page.keyboard.press('Escape');await expect(customer.locator('details[open]')).toHaveCount(0);
  await customer.getByLabel('Reago ndaj mesazhit',{exact:true}).click();await expect(customer.getByRole('button',{name:'Reago ❤️',exact:true})).toBeDisabled();expect(calls.filter(c=>c.target===external)).toHaveLength(count);
  expect(state()).toBe(before);
 } finally {sql(`begin;delete from conversations where id=${quote(cid)};delete from ${channel}_connections where id=${quote(conn)};commit;`);}
});
