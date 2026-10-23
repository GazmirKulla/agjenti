// Authenticated local HTTP + PostgreSQL gate. C1 intent/tickets are prepared by
// recovery-fixtures.test.ts using the real proposal service, NOT an LLM.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createDecipheriv } from 'node:crypto';
import { work, project, localKeys, verifyContainers, sql } from './local.mjs';
import { quote, json, graphFor } from './fixtures.mjs';
import { observeServerActions, readServerAction } from './flight.mjs';

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
  const { result: raw } = await readServerAction(page, () => input.press('Enter'));
  expect(raw.error).toBeUndefined();
  const result = raw.turn ?? raw;
  await expect(page.getByText(result.reply, { exact: true }).last()).toBeVisible();
  const state = decode(raw.session).state;
  await test.info().attach('turn-evidence', { body: Buffer.from(JSON.stringify({ text, reply: result.reply, configuration: result.configuration, state })), contentType: 'application/json' });
  return { ...result, state };
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
test('2B service ambiguity → relative selection uses real catalog and sealed state', async ({ page }) => {
  const t = tenant('quote'), second = randomUUID();
  const original = JSON.parse(sql(`select row_to_json(w) from public.visual_workflows w where business_id=${quote(t.id)};`));
  sql(`insert into public.booking_services(id,business_id,name,duration_minutes,booking_enabled,is_active) values(${quote(second)},${quote(t.id)},'E2E Website Plus',30,false,true);`);
  const graph = graphFor(t); graph.flows[0].serviceIds.push(second);
  sql(`select public.save_visual_workflow(${quote(t.id)},${quote(t.userId)},${original.revision},${json(graph)},'publish');`);
  try {
    await login(page, t); await page.goto(`/b/${t.slug}/agents/test`);
    const offered = await send(page, 'Website');
    expect(offered.state.entityPresentation.entities).toHaveLength(2);
    const expected = offered.state.entityPresentation.entities.find(e => e.displayOrder === 2);
    const selected = await send(page, 'shërbimin e dytë');
    expect(selected.reply).toBe('project_type A?');
    expect(selected.state.processes.service.visual.binding.entity).toEqual({ kind: 'service', id: expected.id });
    expect(selected.state.product_id).toBeNull();
    const field = await send(page, 'Website design'); expect(field.reply).toBe('budget A?');
    const info = await send(page, 'What are your hours?'); expect(info.state.processes.service.status).toBe('suspended');
    const resume = await send(page, 'vazhdo');
    expect(resume.state.processes.service.visual.versionId).toBe(selected.state.processes.service.visual.versionId);
    expect(resume.reply).toBe('budget A?');
  } finally {
    sql(`update public.visual_workflows set published_version_id=${quote(original.published_version_id)},draft=${json(original.draft)},revision=revision+1 where business_id=${quote(t.id)} and revision=${original.revision + 1};`);
  }
});
test.afterAll(() => {
  expect(sql('select (select count(*) from public.orders)+(select count(*) from public.bookings)+(select count(*) from public.messages)+(select count(*) from public.workflow_inbound_queue)+(select count(*) from public.integrations);')).toBe('0');
});
