// Actual local Auth -> Agent Test -> coordinator -> sealed state -> SQL.
// Requires `node e2e/r3-provider.mjs` + `node e2e/local.mjs app-r3`.
// Model output is controlled, not real LLM certification. No raw prompt artifacts.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createDecipheriv} from 'node:crypto';
import path from 'node:path';
import {work,project,verifyContainers,localKeys,sql} from './local.mjs';
import {json,quote} from './fixtures.mjs';
import {observeServerActions,readServerAction} from './flight.mjs';
const f=JSON.parse(readFileSync(path.join(work,'fixtures.json'),'utf8')), t=f.tenants.find(t=>t.kind==='information'), keys=localKeys(), origin='http://localhost:3103';
function decode(token){const[,iv,tag,data]=token.split('.');const d=createDecipheriv('aes-256-gcm',Buffer.from(f.encryptionKey,'hex'),Buffer.from(iv,'base64url'));d.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64url')),d.final()]).toString()).state;}
function effects(){return sql(`select json_build_array((select count(*) from public.orders),(select count(*) from public.order_submissions),(select count(*) from public.bookings),(select count(*) from public.customers),(select count(*) from public.workflow_inbound_queue),(select count(*) from public.workflow_booking_effects),(select count(*) from public.integrations),(select count(*) from public.messages));`);}
function roundtrip(state,reply){
sql(`begin; set local lock_timeout='5s'; set local statement_timeout='10s';
do $test$ declare c uuid:=gen_random_uuid(); ch uuid:=gen_random_uuid(); q public.workflow_inbound_queue; saved jsonb:=${json(state)}; answer text:=${quote(reply)};
begin
insert into public.instagram_connections(id,business_id,ig_user_id,access_token_ciphertext) values(ch,${quote(t.id)},ch::text,'synthetic-only');
insert into public.conversations(id,business_id,instagram_participant_id,instagram_connection_id,auto_reply,status) values(c,${quote(t.id)},c::text,ch,true,'active');
insert into public.conversation_states(conversation_id,business_id) values(c,${quote(t.id)});
insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,conversation_id,status,lease_token,leased_until) values(${quote(t.id)},ch,c::text,c::text,'{}',c,'processing',gen_random_uuid(),now()+interval '2 minutes') returning * into q;
perform public.prepare_workflow_reply(q.id,q.lease_token,c,0,saved,null,answer,null,false);
if (select collected from public.conversation_states where conversation_id=c) is distinct from saved or (select reply from public.workflow_inbound_queue where id=q.id) is distinct from answer then raise exception 'roundtrip_failed'; end if;
update public.workflow_inbound_queue set status='ignored' where id=q.id;
insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,conversation_id,status,lease_token,leased_until) values(${quote(t.id)},ch,c::text,c::text||'-next','{}',c,'processing',gen_random_uuid(),now()+interval '2 minutes') returning * into q;
begin perform public.prepare_workflow_reply(q.id,q.lease_token,c,0,saved,null,'STALE',null,false); raise exception 'stale_accepted' using errcode='XX001'; exception when raise_exception then if sqlerrm<>'stale_state' then raise; end if; end;
end $test$; rollback;`);
}
const captures = [
  { id: 'original', message: 'Miqail\n\nShitje rrobash online\n\nfiliz_studio_\n\nKam pyetje per masat, a eshte gjendje etj', business: 'Shitje rrobash online', needs: 'Kam pyetje per masat, a eshte gjendje etj' },
  { id: 'A', message: 'Miqail\nSHitje rroba online\nfiliz_studio_\nSa kushton, a e keni kete masen', business: 'SHitje rroba online', needs: 'Sa kushton, a e keni kete masen' },
  { id: 'B', message: 'Për të shmangur ngatërrimin, shkruaj me etiketa:\nEmri: Miqail\nLloji i biznesit: Shitje rroba Online\nInstagram: filiz_studio_\nPyetjet tipike: sa kushton? a e keni masen X? etj', business: 'Shitje rroba Online', needs: 'sa kushton? a e keni masen X? etj' },
  { id: 'C', message: 'Emri: Miqail\nLloji i biznesit: Shitje rroba Online\nInstagram: filiz_studio_\nPyetjet tipike: sa kushton? a e keni masen X? etj', business: 'Shitje rroba Online', needs: 'sa kushton? a e keni masen X? etj' },
  { id: 'partial', message: 'Emri: Miqail\nLloji i biznesit: Shitje rroba Online\nInstagram: not-valid\nPyetjet tipike: sa kushton? a e keni masen X? etj', business: 'Shitje rroba Online', needs: 'sa kushton? a e keni masen X? etj', partial: true },
];
for (const capture of captures) test(`P0/F1/F2/F3: ${capture.id}, long conversation, corrections and reload without business effects`,async({page,context})=>{
test.setTimeout(180000);expect(project).toBe('agjenti-e2e-local-recovery-3a-20261023');verifyContainers();
// Synchronous Docker preflight can outlive keep-alive; don't reuse an idle socket.
const health=await fetch('http://127.0.0.1:55325/health',{headers:{connection:'close'}}).then(r=>r.json());expect(health.synthetic).toBe(true);
const before=effects(),evidence=[];
await observeServerActions(page);
await context.route('**/*',r=>[origin,keys.api].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
await context.routeWebSocket('**/*',r=>new URL(r.url()).origin==='ws://localhost:3103'?r.connectToServer():r.close());
await page.goto('/login');await page.getByLabel('Email-i',{exact:true}).fill(t.email);await page.getByPlaceholder('Fjalëkalimi yt',{exact:true}).fill(f.password);await page.getByRole('button',{name:'Hyr në panel →',exact:true}).click();await expect(page).toHaveURL(`${origin}/b/${t.slug}`);await page.goto(`/b/${t.slug}/agents/test`);
async function send(message){const input=page.locator('#agent-test-message');await input.fill(message);const{result}=await readServerAction(page,()=>input.press('Enter'));expect(result.error).toBeUndefined();const turn=result.turn??result,state=decode(result.session);await expect(page.getByText(turn.reply,{exact:true}).last()).toBeVisible();evidence.push({turn:evidence.length+1,source:turn.debug.source,reason:turn.debug.fallbackReason,route:turn.conversationRouting?.process,declaredKeys:Object.keys(state.customerDeclaredFacts??{}),profileKeys:Object.keys(state.context?.profile??{}),workflow:turn.configuration?.workflow});expect(state.processes?.order).toBeUndefined();expect(state.processes?.booking).toBeUndefined();return{state,turn};}
await send('Përshëndetje');await send('Çfarë ofron Agjenti.app?');
const question=await send('Cilat të dhëna të duhen?');expect(question.state.pendingCustomerQuestion?.fields).toEqual(['name','business_type','instagram_handle','stated_needs']);expect(question.turn.reply).not.toContain('[[ask_customer:');
roundtrip(question.state,question.turn.reply);
// Original preceding prose unavailable: server-rendered question is the declared substitute.
let current=await send(capture.message);
if(capture.partial){
  expect(current.state.context.profile.name.value).toBe('Miqail');
  expect(current.state.customerDeclaredFacts.business_type.value).toBe(capture.business);
  expect(current.state.customerDeclaredFacts.stated_needs.value).toBe(capture.needs);
  expect(current.state.customerDeclaredFacts.instagram_handle).toBeUndefined();
  expect(current.state.pendingCustomerQuestion.fields).toEqual(['instagram_handle']);
  expect(current.turn.reply).not.toContain('Emri:');roundtrip(current.state,current.turn.reply);
  await page.reload();current=await send('Instagram: filiz_studio_');
}
expect(current.state.context.profile.name.value).toBe('Miqail');expect(current.state.customerDeclaredFacts.business_type.value).toBe(capture.business);expect(current.state.customerDeclaredFacts.instagram_handle.value).toBe('filiz_studio_');expect(current.state.customerDeclaredFacts.stated_needs.value).toBe(capture.needs);expect(current.state.pendingCustomerQuestion).toBeUndefined();
for(const message of ['sapo ti shkrova me lart','a po me kupton?','Ku mund të regjistrohem?','Ta bëjmë një test sikur ti të ishe klienti?','A keni këmishë të zezë në gjendje?','Për cilin produkt po flasim?',...Array.from({length:12},(_,i)=>`Çfarë informacioni keni? ${i}`)]) { current=await send(message); expect(current.state.pendingCustomerQuestion).toBeUndefined(); }
expect(current.state.recentMessages).toHaveLength(10);expect(JSON.stringify(current.state.recentMessages)).not.toContain('filiz_studio_');await page.reload();
for(const message of ['Si e kisha emrin une?','Po ta dhashë që në fillim.','Po dhe si quhem?','Si e kam emrin?']){current=await send(message);expect(current.turn.reply).toContain('Miqail');expect(current.turn.reply).not.toContain('Nuk ma ke');}
for(const message of ['Çfarë shes unë?','Jo, unë Miqaili çfarë shes?','Edhe njëherë, çfarë shes unë?']){current=await send(message);expect(current.turn.reply).toContain(capture.business);expect(current.turn.reply).not.toContain('automatizim AI');}
current=await send('Ku i shes?');expect(current.turn.reply).toContain('nuk provon');
current=await send('Cili është Instagram-i im?');expect(current.turn.reply).toContain('filiz_studio_');
// Customer reply formatting puts question examples on separate lines. Preserve
// every word/punctuation; exact authoritative value is asserted independently.
current=await send('Çfarë pyetjesh marr zakonisht?');expect(current.turn.reply.replace(/\s+/g,' ')).toContain(capture.needs);
expect(current.state.customerDeclaredFacts.stated_needs.value).toBe(capture.needs);
current=await send('Si quhem? përgjigju saktë');expect(current.turn.reply).toBe('Ti quhesh Miqail.');
current=await send('A njoftove stafin?');expect(current.turn.reply).not.toContain('Stafi u njoftua');expect(current.state.staffHandoff).not.toBe(true);
current=await send('Si mund të kontaktoj stafin?');expect(current.state.staffHandoff).not.toBe(true); // staff module OFF: no ownership takeover
current=await send('Profili im në Instagram është corrected_shop');current=await send('Cili është Instagrami im?');expect(current.turn.reply).toContain('corrected_shop');expect(current.turn.reply).not.toContain('filiz_studio_');
expect(evidence.length).toBeGreaterThanOrEqual(28);expect(current.state.context.profile.name.value).toBe('Miqail');expect(current.state.context.order).toEqual({});roundtrip(current.state,current.turn.reply);expect(effects()).toBe(before);
const after=await fetch('http://127.0.0.1:55325/health',{headers:{connection:'close'}}).then(r=>r.json());expect(after.calls).toBeGreaterThan(health.calls);
await test.info().attach('boundaries-only',{body:Buffer.from(JSON.stringify({syntheticModel:true,realModel:false,turns:evidence.length,sqlRoundtrip:true,staleRejected:true,zeroBusinessEffects:true,evidence})),contentType:'application/json'});
});

test('P0 duplicate partial answer exits clarification loop without losing accepted facts', async ({page,context}) => {
  test.setTimeout(90000);verifyContainers();const before=effects();
  await observeServerActions(page);
  await context.route('**/*',r=>[origin,keys.api].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
  await context.routeWebSocket('**/*',r=>new URL(r.url()).origin==='ws://localhost:3103'?r.connectToServer():r.close());
  await page.goto('/login');await page.getByLabel('Email-i',{exact:true}).fill(t.email);await page.getByPlaceholder('Fjalëkalimi yt',{exact:true}).fill(f.password);
  await page.getByRole('button',{name:'Hyr në panel →',exact:true}).click();await expect(page).toHaveURL(`${origin}/b/${t.slug}`);await page.goto(`/b/${t.slug}/agents/test`);
  async function send(message){const input=page.locator('#agent-test-message');await input.fill(message);const{result}=await readServerAction(page,()=>input.press('Enter'));expect(result.error).toBeUndefined();await expect(page.getByText(result.reply,{exact:true}).last()).toBeVisible();expect(result.externalActions??[]).toEqual([]);return{state:decode(result.session),reply:result.reply};}
  await send('Cilat të dhëna të duhen?');
  const partial='Emri: Elira; Instagram: not-valid';
  const first=await send(partial);expect(first.state.context.profile.name.value).toBe('Elira');roundtrip(first.state,first.reply);
  const duplicate=await send(partial);expect(duplicate.state.pendingCustomerQuestion.fields).not.toContain('name');
  const stopped=await send(partial);expect(stopped.state.pendingCustomerQuestion).toBeUndefined();expect(stopped.reply).not.toContain('Emri:');
  expect(stopped.state.context.profile.name.value).toBe('Elira');expect(stopped.state.staffHandoff).not.toBe(true);
  roundtrip(stopped.state,stopped.reply);expect(effects()).toBe(before);
});
