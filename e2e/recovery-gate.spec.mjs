// Authenticated local HTTP + PostgreSQL gate. C1 intent/tickets are prepared by
// recovery-fixtures.test.ts using the real proposal service, NOT an LLM.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createDecipheriv } from 'node:crypto';
import { work, project, localKeys, verifyContainers, sql } from './local.mjs';
import { quote, json, graphFor } from './fixtures.mjs';
import { observeServerActions, readServerAction, resultFromFlight } from './flight.mjs';

const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const plans = JSON.parse(readFileSync(path.join(work, 'c1-proposals.json'), 'utf8'));
const keys = localKeys(), origin = 'http://localhost:3103';
const tenant = kind => fixtures.tenants.find(t => t.kind === kind);
const proposal = kind => plans.find(p => p.kind === kind);
function decode(token) {
  const [version, iv, tag, data] = token.split('.'); expect(version).toBe('v1');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(fixtures.encryptionKey, 'hex'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString());
}
async function login(page, t) {
  await page.goto('/login'); await page.getByLabel('Email-i', { exact: true }).fill(t.email);
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(fixtures.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/b/${t.slug}`);
}
async function send(page, text, preview = false) {
  const input = preview ? page.getByRole('textbox', { name: 'Mesazhi i provës' }) : page.locator('#agent-test-message'); await input.fill(text);
  const { result: raw, request } = await readServerAction(page, () => input.press('Enter'));
  expect(raw.error).toBeUndefined();
  const result = raw.turn ?? raw;
  await expect(page.getByText(result.reply, { exact: true }).last()).toBeVisible();
  const state = decode(raw.session).state;
  await test.info().attach('turn-evidence', { body: Buffer.from(JSON.stringify({ text, reply: result.reply, configuration: result.configuration, state })), contentType: 'application/json' });
  return { ...result, state, token: raw.session, request };
}
const post = (page, t, body) => page.request.post(`/api/business-assistant?slug=${t.slug}`, { headers: { origin }, data: body });
test.beforeAll(() => { expect(project).toMatch(/^agjenti-e2e-local-recovery-[a-z0-9-]+$/); verifyContainers(); });
test.beforeEach(async ({ context, page }) => {
  await observeServerActions(page);
  await context.route('**/*', r => [origin, keys.api].includes(new URL(r.request().url()).origin) ? r.continue() : r.abort('blockedbyclient'));
  await context.routeWebSocket('**/*', r => new URL(r.url()).origin === 'ws://localhost:3103' ? r.connectToServer() : r.close());
});
test('C1 natural-language planning is explicitly unavailable offline, not a simulated success', async ({ page }) => {
  const t = tenant('retail'); await login(page, t);
  const r = await post(page, t, { mode: 'plan', text: 'Ndrysho udhëzimet e agjentit.' });
  expect(r.ok()).toBe(false);
  expect(await r.json()).toMatchObject({ error: 'Asistenti AI nuk është konfiguruar ende.' });
  expect(sql(`select instructions from public.ai_agents where id=${quote(proposal('retail').id)};`)).toBe(proposal('retail').before);
});
for (const kind of ['retail', 'information']) test(`C1 ${kind}: authenticated approval → DB receipt → actual runtime provenance`, async ({ page }) => {
  const t = tenant(kind), p = proposal(kind); await login(page, t);
  const conversationId = randomUUID(), requestId = randomUUID();
  const created = await page.request.post(`/api/business-assistant/conversations?slug=${t.slug}`, { headers: { origin }, data: { mode: 'create', id: conversationId } });
  expect(created.status()).toBe(200);
  const body = { mode: 'confirm', token: p.plan.token, conversationId, requestId, revision: 0 };
  const response = await post(page, t, body); const receipt = await response.json();
  expect(receipt.error).toBeUndefined(); expect(receipt.saved).toBe(true);
  expect(receipt.configurationEffect).toMatchObject({ saved: true, effective: p.active, status: p.active ? 'effective' : 'inactive', behaviorVerified: false, instructionHash: p.hash });
  expect(sql(`select instructions from public.ai_agents where id=${quote(p.id)} and business_id=${quote(t.id)};`)).toBe(p.after);
  expect(sql(`select is_active from public.ai_agents where id=${quote(p.id)};`)).toBe(p.active ? 't' : 'f');
  const stored = JSON.parse(sql(`select outcome from public.assistant_messages where conversation_id=${quote(conversationId)} and kind='backend_outcome';`));
  expect(stored.configurationEffect).toEqual(receipt.configurationEffect);
  const updatedAt = sql(`select updated_at from public.ai_agents where id=${quote(p.id)};`);
  const duplicate = await post(page, t, body); expect(await duplicate.json()).toMatchObject({ saved: true, recovered: true });
  expect(sql(`select updated_at from public.ai_agents where id=${quote(p.id)};`)).toBe(updatedAt);
  const replay = await post(page, t, { mode: 'confirm', token: p.plan.token });
  expect(replay.ok()).toBe(false); expect(await replay.json()).not.toHaveProperty('saved', true);
  await page.goto(`/b/${t.slug}/agents/test`);
  const turn = await send(page, 'Përshëndetje');
  expect(turn.configuration.behaviorVerified).toBe(false);
  expect(turn.configuration.agents).toContainEqual(expect.objectContaining(p.active
    ? { agentId: p.id, active: true, instructionHash: p.hash, instructionSource: 'active_agent' }
    : { agentId: null, instructionHash: null, instructionSource: 'base', fallbackReason: 'no_active_agent' }));
  expect(turn.configuration.responseFallbackReason).toBe('missing_api_key');
  if (!p.active) await expect(page.getByRole('status').filter({ hasText: 'Nuk ka agjent klientësh aktiv' })).toBeVisible();
  await page.getByText('Konfigurimi i përdorur në këtë provë', { exact: true }).click();
  await expect(page.getByText('Integrimi AI nuk është konfiguruar.', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText(turn.reply, { exact: true }).last()).toBeVisible();
  const history = await page.request.get(`/api/business-assistant/conversations?slug=${t.slug}&id=${conversationId}`);
  expect((await history.json()).messages.find(m => m.kind === 'backend_outcome').outcome.configurationEffect.behaviorVerified).toBe(false);
});
test('C1 cross-tenant token and stale approval are rejected without writing', async ({ page }) => {
  const t = tenant('quote'), p = proposal('quote');
  await login(page, tenant('retail'));
  const denied = await post(page, tenant('retail'), { mode: 'confirm', token: p.plan.token });
  expect(denied.ok()).toBe(false);
  const foreign = await post(page, t, { mode: 'confirm', token: p.plan.token }); expect(foreign.status()).toBe(403);
  expect(sql(`select instructions from public.ai_agents where id=${quote(p.id)};`)).toBe(p.before);
  await page.context().clearCookies(); await login(page, t);
  sql(`update public.ai_agents set instructions='Synthetic concurrent correction',updated_at=clock_timestamp() where id=${quote(p.id)} and business_id=${quote(t.id)};`);
  const stale = await post(page, t, { mode: 'confirm', token: p.plan.token }); expect(stale.ok()).toBe(false);
  expect(await stale.json()).not.toHaveProperty('saved', true);
  expect(sql(`select instructions from public.ai_agents where id=${quote(p.id)};`)).toBe('Synthetic concurrent correction');
});
test('C1 provenance identifies actual published/pinned version and explicit draft hash', async ({ page }) => {
  const t = tenant('retail'); await login(page, t); await page.goto(`/b/${t.slug}/agents/test`);
  const first = await send(page, 'Dua të porosis E2E Shirt');
  expect(first.configuration.workflow).toMatchObject({ versionId: t.versionA, mode: 'published' });
  const next = await send(page, 'M');
  expect(next.configuration.workflow).toMatchObject({ versionId: t.versionA, mode: 'pinned' });
  await page.goto(`/b/${t.slug}/workflows`); await page.getByRole('button', { name: 'Provo rrjedhën' }).click();
  const draft = await send(page, 'Dua të porosis E2E Shirt', true);
  expect(draft.reply).toBe('size DRAFT?');
  expect(draft.configuration.workflow.mode).toBe('draft');
  expect(draft.configuration.workflow.versionId).toBe(draft.state.visual.versionId);
  expect(draft.configuration.workflow.versionId).toMatch(/^preview:/);
});
for (const choice of ['bare', 'information', 'explicit', 'pending']) test(`2B service ambiguity → ${choice} relative selection uses real catalog and sealed state`, async ({ page }) => {
  const t = tenant('quote'), first = randomUUID(), second = randomUUID(), label = `Selection ${randomUUID()}`;
  const original = JSON.parse(sql(`select row_to_json(w) from public.visual_workflows w where business_id=${quote(t.id)};`));
  sql(`insert into public.booking_services(id,business_id,name,duration_minutes,booking_enabled,is_active) values(${quote(first)},${quote(t.id)},${quote(`${label} Basic`)},30,false,true),(${quote(second)},${quote(t.id)},${quote(`${label} Plus`)},30,false,true);`);
  const graph = graphFor(t); graph.flows[0].serviceIds = [first, second];
  sql(`select public.save_visual_workflow(${quote(t.id)},${quote(t.userId)},${original.revision},${json(graph)},'publish');`);
  let revision = original.revision + 1;
  try {
    await login(page, t); await page.goto(`/b/${t.slug}/agents/test`);
    const offered = await send(page, choice === 'pending' ? `Dua të vazhdoj me ${label}` : label);
    expect(offered.state.entityPresentation.entities).toHaveLength(2);
    const expected = offered.state.entityPresentation.entities.find(e => e.displayOrder === 2);
    const versionA = sql(`select published_version_id from public.visual_workflows where business_id=${quote(t.id)};`);
    if (choice === 'pending') {
      expect(offered.state.processes.pendingServiceSelection.versionId).toBe(versionA);
      const versionB = structuredClone(graph); versionB.nodes.find(n => n.id === 'project_type').config.prompt = 'project_type B?';
      sql(`select public.save_visual_workflow(${quote(t.id)},${quote(t.userId)},${revision},${json(versionB)},'publish');`); revision++;
    } else expect(offered.state.processes.pendingServiceSelection).toBeUndefined();
    const selected = await send(page, choice === 'information' ? 'Më trego shërbimin e dytë' : choice === 'explicit' ? 'Dua të vazhdoj me shërbimin e dytë' : 'shërbimin e dytë');
    if (choice === 'bare' || choice === 'information') {
      expect(selected.state.processes.service).toBeUndefined(); expect(selected.state.processes.booking).toBeUndefined();
      expect(selected.state.product_id).toBeNull(); expect(selected.reply).not.toBe('project_type A?');
      return;
    }
    expect(selected.reply).toBe('project_type A?');
    expect(selected.state.processes.service.visual.binding.entity).toEqual({ kind: 'service', id: expected.id });
    expect(selected.state.processes.service.visual.versionId).toBe(versionA);
    expect(selected.state.processes.service.visual.nodeId).toBe('project_type');
    expect(selected.state.processes.pendingServiceSelection).toBeUndefined();
    expect(selected.state.product_id).toBeNull();
    expect(selected.turnDecision).toMatchObject({ intent: 'service', kind: 'new_process', entity: { kind: 'service', id: expected.id } });
    if (choice === 'pending') {
      // The browser endpoint uses sealed sessions. Separately verify those exact
      // checkpoints through the channel persistence RPC, with all SQL rolled back.
      sql(`begin; set local lock_timeout='5s'; set local statement_timeout='10s';
        do $test$ declare c uuid:=gen_random_uuid(); channel_id uuid:=gen_random_uuid(); q public.workflow_inbound_queue;
          pending jsonb:=${json(offered.state)}; selected jsonb:=${json(selected.state)};
        begin
          insert into public.instagram_connections(id,business_id,ig_user_id,access_token_ciphertext) values(channel_id,${quote(t.id)},channel_id::text,'synthetic-only');
          insert into public.conversations(id,business_id,instagram_participant_id,instagram_connection_id,auto_reply,status)
            values(c,${quote(t.id)},c::text,channel_id,true,'active');
          insert into public.conversation_states(conversation_id,business_id) values(c,${quote(t.id)});
          insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,conversation_id,status,lease_token,leased_until)
            values(${quote(t.id)},channel_id,c::text,c::text,'{}',c,'processing',gen_random_uuid(),now()+interval '2 minutes') returning * into q;
          perform public.prepare_workflow_reply(q.id,q.lease_token,c,0,pending,null,'Synthetic selection',null,false);
          if (select collected from public.conversation_states where conversation_id=c) is distinct from pending then raise exception 'pending_state_roundtrip_failed'; end if;
          update public.workflow_inbound_queue set status='ignored' where id=q.id;
          insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,conversation_id,status,lease_token,leased_until)
            values(${quote(t.id)},channel_id,c::text,c::text||'-2','{}',c,'processing',gen_random_uuid(),now()+interval '2 minutes') returning * into q;
          begin
            perform public.prepare_workflow_reply(q.id,q.lease_token,c,0,pending,null,'Stale selection',null,false);
            raise exception 'stale_selection_accepted' using errcode='XX001';
          exception when raise_exception then if sqlerrm<>'stale_state' then raise; end if; end;
          perform public.prepare_workflow_reply(q.id,q.lease_token,c,1,selected,null,'Synthetic process',null,false);
          if (select collected from public.conversation_states where conversation_id=c) is distinct from selected
            or (select revision from public.conversation_states where conversation_id=c)<>2 then raise exception 'selected_state_roundtrip_failed'; end if;
        end $test$; rollback;`);
    }
    // A field value, not the name shared by other historical synthetic services.
    const field = await send(page, 'Landing page'); expect(field.reply).toBe('budget A?');
    expect(field.state.processes.service.order.project_type.value).toBe('Landing page');
    const info = await send(page, 'What are your hours?'); expect(info.state.processes.service.status).toBe('suspended');
    const resume = await send(page, 'vazhdo');
    expect(resume.state.processes.service.visual.versionId).toBe(selected.state.processes.service.visual.versionId);
    expect(resume.reply).toBe('budget A?');
    const profile = JSON.parse(sql(`select dashboard_profile from public.businesses where id=${quote(t.id)};`));
    try {
      sql(`select public.save_business_modules(${quote(t.id)},${quote(t.userId)},${json({ ...profile, enabledModules: profile.enabledModules.filter(m => m !== 'services') })});`);
      const blocked = await send(page, '1500');
      expect(blocked.reply).toContain('çaktivizuar');
      expect(blocked.state.processes.service.visual).toEqual(resume.state.processes.service.visual);
      expect(blocked.state.processes.service.order.budget).toBeUndefined();
    } finally { sql(`select public.save_business_modules(${quote(t.id)},${quote(t.userId)},${json(profile)});`); }
    if (choice === 'pending') {
      const args = JSON.parse(selected.request.body);
      const foreign = tenant('retail');
      await page.context().clearCookies(); await login(page, foreign);
      args[0].slug = foreign.slug; args[0].session = selected.token; args[0].message = 'shërbimin e dytë';
      const denied = await page.request.post(`/b/${foreign.slug}/agents/test`, {
        headers: { 'next-action': selected.request.headers['next-action'], origin, 'content-type': 'text/plain;charset=UTF-8' }, data: JSON.stringify(args),
      });
      expect(resultFromFlight(await denied.text())).toEqual({ error: 'Sesioni i provës ka skaduar ose nuk është i vlefshëm. Shtyp Rifillo.' });
    }
  } finally {
    expect(sql(`update public.visual_workflows set published_version_id=${quote(original.published_version_id)},draft=${json(original.draft)},revision=revision+1 where business_id=${quote(t.id)} and revision=${revision} returning revision;`)).toBe(String(revision + 1));
    sql(`update public.booking_services set is_active=false where business_id=${quote(t.id)} and id in (${quote(first)},${quote(second)});`);
  }
});
test.afterAll(() => {
  expect(sql('select (select count(*) from public.orders)+(select count(*) from public.bookings)+(select count(*) from public.messages)+(select count(*) from public.workflow_inbound_queue)+(select count(*) from public.integrations);')).toBe('0');
});
