import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { work, verifyContainers, localKeys, sql } from './local.mjs';
import { quote, json, graphFor } from './fixtures.mjs';
import { resultFromFlight, observeServerActions, readServerAction } from './flight.mjs';

const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const tenant = kind => fixtures.tenants.find(t => t.kind === kind);
const keys = localKeys();
function decode(token) {
  const [version, iv, tag, data] = token.split('.');
  expect(version).toBe('v1');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(fixtures.encryptionKey, 'hex'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString());
}
function sealSyntheticSession(session) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(fixtures.encryptionKey, 'hex'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}
function workflowSnapshot(t) {
  return JSON.parse(sql(`select json_build_object('workspace', (select row_to_json(w) from public.visual_workflows w where business_id=${quote(t.id)}),
    'versions', (select count(*) from public.visual_workflow_versions where business_id=${quote(t.id)}),
    'events', (select count(*) from public.visual_workflow_events where business_id=${quote(t.id)}));`));
}
async function login(page, user) {
  await page.goto('/login');
  await page.getByLabel('Email-i', { exact: true }).fill(user.email);
  // The wrapping label also contains the visible show/hide button text.
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(fixtures.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  // Wait for the final authenticated destination, not the intermediate redirect.
  await expect(page).toHaveURL(user.slug ? `http://localhost:3103/b/${user.slug}` : 'http://localhost:3103/admin');
}
async function send(page, message, preview = false) {
  const input = preview ? page.getByRole('textbox', { name: 'Mesazhi i provës' }) : page.locator('#agent-test-message');
  await input.fill(message);
  const { result: raw, request } = await readServerAction(page, () => input.press('Enter'));
  expect(raw.error).toBeUndefined();
  const result = raw.turn ?? raw;
  const session = decode(raw.session);
  await expect(page.getByText(result.reply, { exact: true }).last()).toBeVisible();
  return { ...result, state: session.state, token: raw.session, request };
}
async function startChat(page, t) {
  await login(page, t);
  await page.goto(`/b/${t.slug}/agents/test`);
  await expect(page.locator('#agent-test-message')).toBeVisible();
}
test.beforeAll(() => verifyContainers());
test.beforeEach(async ({ context, page }) => {
  await observeServerActions(page);
  await context.routeWebSocket('**/*', route => {
    const url = new URL(route.url());
    if (url.origin === 'ws://localhost:3103') route.connectToServer();
    else route.close({ code: 1008, reason: 'Local E2E only' });
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http://localhost:3103', keys.api].includes(url.origin)) await route.continue();
    else await route.abort('blockedbyclient');
  });
});

test('bootstrap smoke: real login → tenant → draft preview → configured field → returned state', async ({ page }) => {
  const t = tenant('retail'); await login(page, t);
  await page.goto(`/b/${t.slug}/workflows`);
  await page.getByRole('button', { name: 'Provo rrjedhën' }).click();
  const first = await send(page, 'E2E Shirt', true);
  expect(first.reply).toBe('size DRAFT?');
  expect(first.state.visual.versionId).toMatch(/^preview:/);
  const second = await send(page, 'M', true);
  expect(second.reply).toBe('quantity DRAFT?');
  expect(second.state.context.order.size.value).toBe('M');
  expect(second.state.visual.nodeId).toBe('quantity');
  expect(decode(second.token).businessId).toBe(t.id);
  expect(second.state.context.order.quantity).toBeUndefined();
  await page.screenshot({ path: path.join(work, 'smoke-preview.png'), fullPage: true });
});

test('real login, owner dashboard and PostgREST RLS reject a foreign tenant', async ({ page }) => {
  const t = tenant('retail');
  await startChat(page, t);
  await expect(page.getByRole('heading', { name: 'Provo Agjentin' })).toBeVisible();
  await page.goto(`/b/${tenant('quote').slug}/agents/test`);
  await expect(page).not.toHaveURL(new RegExp(`/b/${tenant('quote').slug}/agents/test`));
  const client = createClient(keys.api, keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const signup = await client.auth.signUp({ email: 'uninvited@example.test', password: fixtures.password });
  expect(signup.error?.code).toBe('signup_disabled');
  const signed = await client.auth.signInWithPassword({ email: t.email, password: fixtures.password });
  expect(signed.error).toBeNull();
  const own = await client.from('businesses').select('id').eq('id', t.id);
  const foreign = await client.from('businesses').select('id').eq('id', tenant('quote').id);
  expect(own.data).toEqual([{ id: t.id }]); expect(foreign.data).toEqual([]);
  const rpc = await client.rpc('save_visual_workflow', { p_business: tenant('quote').id, p_user: t.userId, p_revision: 2, p_graph: null, p_operation: 'disable' });
  expect(rpc.error).not.toBeNull();
});

test('published retail: entity, size/quantity, invalid input, interruption/resume and cancellation', async ({ page }) => {
  const t = tenant('retail'); await startChat(page, t);
  const start = await send(page, 'E2E Shirt');
  expect(start.reply).toBe('size A?'); expect(start.state.visual.versionId).toBe(t.versionA);
  const size = await send(page, 'M'); expect(size.reply).toBe('quantity A?');
  const invalid = await send(page, 'many'); expect(invalid.state.visual.nodeId).toBe('quantity');
  expect(invalid.state.context.order.quantity).toBeUndefined();
  const info = await send(page, 'What does this product include?');
  expect(info.state.context.order.size.value).toBe('M');
  expect(info.state.processes.order.status).toBe('suspended');
  const resume = await send(page, 'Vazhdo porosinë'); expect(resume.reply).toBe('quantity A?');
  const value = await send(page, '4'); expect(value.state.visual.nodeId).toBe('confirm');
  expect(value.state.context.order.quantity.value).toBe('4');
  expect(value.state.context.order.child_age).toBeUndefined();
  await page.reload(); // Browser session persistence, not DB conversation persistence.
  await expect(page.getByText(value.reply, { exact: true }).last()).toBeVisible();
  // W1 cancellation is a reply to a fresh, task-bound clarification, not a
  // free-standing command that may arbitrarily remove an active process.
  const staleCancel = await send(page, 'leje fare');
  expect(staleCancel.conversationRouting.reason).toBe('clarification_stale');
  expect(staleCancel.state.processes.order).toEqual(value.state.processes.order);
  const paused = await send(page, 'jo tani');
  expect(paused.state.processes.order.status).toBe('suspended');
  const clarification = await send(page, 'maybe later please');
  expect(clarification.reply).toBe('Dëshiron të vazhdojmë kërkesën e mëparshme, apo po kërkon vetëm informacion?');
  expect(clarification.state.processes.pendingClarification.target).toMatchObject({ process: 'order', id: value.state.processes.order.id, versionId: t.versionA });
  const cancel = await send(page, 'leje fare');
  expect(cancel.conversationRouting.reason).toBe('clarification_cancel');
  expect(cancel.state.processes.order).toBeUndefined();
  expect(cancel.state.processes.pendingClarification).toBeUndefined();
  expect(cancel.state.context.order).toEqual({});
  expect(cancel.state.product_id).toBeNull();
  const repeated = await send(page, 'leje fare');
  expect(repeated.reply).toBe(cancel.reply);
  expect(repeated.state.processes.order).toBeUndefined();
});

test('draft preview uses DRAFT graph; changed graph rejects old session; missing binding is explicit', async ({ page }) => {
  const t = tenant('retail'); await login(page, t);
  await page.goto(`/b/${t.slug}/workflows`);
  await page.getByRole('button', { name: 'Provo rrjedhën' }).click();
  const start = await send(page, 'E2E Shirt', true);
  expect(start.reply).toBe('size DRAFT?'); expect(start.state.visual.versionId).toMatch(/^preview:/);
  const args = JSON.parse(start.request.body);
  args[1].name += ' changed'; args[3] = start.token;
  const headers = { 'next-action': start.request.headers['next-action'], origin: 'http://localhost:3103', 'content-type': 'text/plain;charset=UTF-8' };
  const stale = await page.request.post(start.request.url, { headers, data: JSON.stringify(args) });
  expect(resultFromFlight(await stale.text()).error).toBe('Rrjedha ndryshoi. Rifillo provën.');
  // Valid empty binding: no general order flow, so it must not use legacy order collection.
  args[1] = graphFor(t, 'UNBOUND'); args[1].flows = [{ ...args[1].flows[0], kind: 'custom', productIds: [] }]; args[3] = null;
  const unbound = await page.request.post(start.request.url, { headers, data: JSON.stringify(args) });
  const result = resultFromFlight(await unbound.text());
  expect(result.turn.debug.fallbackReason).toBe('preview_binding_missing');
  expect(decode(result.session).state.context.order).toEqual({});
});

test('real published A stays pinned when B is seeded through the authorized SQL RPC', async ({ page }) => {
  const t = tenant('retail'); await startChat(page, t);
  const first = await send(page, 'E2E Shirt'); expect(first.state.visual.versionId).toBe(t.versionA);
  const interrupted = await send(page, 'What does this product include?');
  expect(interrupted.state.processes.order.status).toBe('suspended');
  const revision = Number(sql(`select revision from public.visual_workflows where business_id=${quote(t.id)};`));
  sql(`select public.save_visual_workflow(${quote(t.id)},${quote(t.userId)},${revision},${json(graphFor(t, 'B'))},'publish');`);
  try {
    const resumed = await send(page, 'Vazhdo porosinë');
    expect(resumed.reply).toBe('size A?');
    expect(resumed.state.processes.order.id).toBe(first.state.processes.order.id);
    expect(resumed.state.visual.versionId).toBe(t.versionA);
    const next = await send(page, 'M'); expect(next.reply).toBe('quantity A?'); expect(next.state.visual.versionId).toBe(t.versionA);
    await send(page, 'jo tani');
    const clarification = await send(page, 'maybe later please');
    expect(clarification.state.processes.pendingClarification.target.id).toBe(first.state.processes.order.id);
    const cancelled = await send(page, 'leje fare');
    expect(cancelled.state.processes.order).toBeUndefined();
    expect(cancelled.state.processes.informationOnly).toBe(true);
    // W1 cancellation requires fresh ordering intent, not just an entity name.
    const newProcess = await send(page, 'Dua të porosis E2E Shirt');
    expect(newProcess.reply).toBe('size B?');
    expect(newProcess.state.processes.order.id).not.toBe(first.state.processes.order.id);
    expect(newProcess.state.visual.versionId).not.toBe(t.versionA);
    await page.evaluate(() => sessionStorage.clear()); await page.reload();
    const fresh = await send(page, 'E2E Shirt'); expect(fresh.reply).toBe('size B?'); expect(fresh.state.visual.versionId).not.toBe(t.versionA);
    expect(fresh.state.visual.versionId).toBe(newProcess.state.visual.versionId);
    expect(fresh.state.processes.order.id).not.toBe(first.state.processes.order.id);
  } finally {
    // Fixture restoration is itself an audited write: keep revisions monotonic.
    // Preserve all immutable versions and refuse to overwrite an intervening write.
    expect(sql(`update public.visual_workflows set published_version_id=${quote(t.versionA)},draft=${json(graphFor(t, 'DRAFT'))},
      revision=revision+1,updated_at=clock_timestamp(),updated_by=${quote(t.userId)}
      where business_id=${quote(t.id)} and revision=${revision + 1} returning revision;`)).toBe(String(revision + 2));
  }
});

test('expired and cross-tenant sealed sessions fail before executing another turn', async ({ page }) => {
  const t = tenant('retail'); await startChat(page, t);
  const first = await send(page, 'E2E Shirt');
  const args = JSON.parse(first.request.body);
  const headers = { 'next-action': first.request.headers['next-action'], origin: 'http://localhost:3103', 'content-type': 'text/plain;charset=UTF-8' };
  args[0].message = 'M';
  args[0].session = sealSyntheticSession({ ...decode(first.token), expiresAt: Date.now() - 1 });
  const expired = await page.request.post(first.request.url, { headers, data: JSON.stringify(args) });
  const failure = { error: 'Sesioni i provës ka skaduar ose nuk është i vlefshëm. Shtyp Rifillo.' };
  expect(resultFromFlight(await expired.text())).toEqual(failure);
  await page.context().clearCookies();
  const foreign = tenant('quote'); await login(page, foreign);
  args[0].slug = foreign.slug; args[0].session = first.token;
  const transplanted = await page.request.post(`/b/${foreign.slug}/agents/test`, { headers, data: JSON.stringify(args) });
  expect(resultFromFlight(await transplanted.text())).toEqual(failure);
});

test('failed publication is visible and leaves workspace, versions and audit unchanged', async ({ page }) => {
  const t = tenant('retail'); await login(page, t);
  await page.goto(`/b/${t.slug}/workflows`);
  const before = workflowSnapshot(t);
  const pending = page.waitForResponse(r => r.url().endsWith('/api/workflows/visual') && r.request().postDataJSON()?.operation === 'publish');
  await page.getByRole('button', { name: 'Publiko', exact: true }).click();
  const response = await pending, result = await response.json();
  expect(result.publication).toMatchObject({ canPublish: false, result: 'BLOCKED', status: 'needs_setup' });
  expect(result.publication.findings).toContainEqual(expect.objectContaining({ code: 'runtime_not_ready' }));
  expect(result.savedRevision).toBeUndefined();
  await expect(page.getByRole('region', { name: 'Gatishmëria e publikimit' }).getByText(result.error, { exact: true })).toBeVisible();
  expect(workflowSnapshot(t)).toEqual(before);
  const foreign = tenant('quote'), foreignBefore = workflowSnapshot(foreign);
  const denied = await page.request.post('/api/workflows/visual', { headers: { origin: 'http://localhost:3103' },
    data: { slug: foreign.slug, revision: foreignBefore.workspace.revision, operation: 'publish', graph: graphFor(foreign, 'UNAUTHORIZED') } });
  expect(await denied.json()).toEqual({ error: 'Nuk ke qasje në këtë biznes.' });
  expect(workflowSnapshot(foreign)).toEqual(foreignBefore);
});

test('real publication RPC rejects stale revision, invalid binding and unauthorized actor atomically', async () => {
  const t = tenant('retail'), foreign = tenant('quote'), before = workflowSnapshot(t);
  const client = createClient(keys.api, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const boundElsewhere = graphFor(t, 'FOREIGN'); boundElsewhere.flows[0].productIds = [foreign.entityId];
  const base = { p_business: t.id, p_user: t.userId, p_revision: before.workspace.revision, p_graph: graphFor(t, 'REJECTED'), p_operation: 'publish' };
  for (const [patch, error] of [
    [{ p_revision: before.workspace.revision - 1 }, 'stale_workflow'],
    [{ p_graph: boundElsewhere }, 'invalid_workflow_targets'],
    [{ p_user: foreign.userId }, 'unauthorized'],
  ]) {
    const response = await client.rpc('save_visual_workflow', { ...base, ...patch });
    expect(response.error?.message).toContain(error);
    expect(workflowSnapshot(t)).toEqual(before);
  }
});

test('module OFF preserves cursor and facts rather than advancing', async ({ page }) => {
  const t = tenant('retail'); await startChat(page, t);
  await send(page, 'E2E Shirt'); const before = await send(page, 'M');
  const profile = JSON.parse(sql(`select dashboard_profile from public.businesses where id=${quote(t.id)};`));
  sql(`select public.save_business_modules(${quote(t.id)},${quote(t.userId)},${json({ ...profile, enabledModules: profile.enabledModules.filter(m => m !== 'orders') })});`);
  try {
    const blocked = await send(page, '4'); expect(blocked.state.visual).toEqual(before.state.visual);
    expect(blocked.state.context.order.quantity).toBeUndefined(); expect(blocked.reply).toContain('çaktivizuar');
  } finally { sql(`select public.save_business_modules(${quote(t.id)},${quote(t.userId)},${json(profile)});`); }
});

test('quote owns project_type/budget independently of retail facts', async ({ page }) => {
  await startChat(page, tenant('quote'));
  const start = await send(page, 'E2E Website'); expect(start.reply).toBe('project_type A?');
  const project = await send(page, 'Website'); expect(project.reply).toBe('budget A?');
  const invalid = await send(page, 'many'); expect(invalid.state.processes.service.visual.nodeId).toBe('budget');
  const valid = await send(page, '1500'); expect(valid.state.processes.service.order.budget.value).toBe('1500');
  expect(valid.state.context.order.quantity).toBeUndefined(); expect(valid.state.context.order.child_age).toBeUndefined();
});

test('information-only business never creates an order or booking process', async ({ page }) => {
  await startChat(page, tenant('information'));
  const result = await send(page, 'What are your hours?');
  expect(result.state.context.order).toEqual({}); expect(result.state.processes.order).toBeUndefined(); expect(result.state.processes.booking).toBeUndefined();
  expect(result.debug.fallbackReason).toBe('missing_api_key');
});

test('appointment fails closed without the external extraction provider (not date E2E)', async ({ page }) => {
  await startChat(page, tenant('appointment'));
  const result = await send(page, 'E2E Consultation');
  expect(result.reply).toContain('Nuk e kuptova');
  expect(result.state.processes.booking.draft.serviceId).toBe(tenant('appointment').entityId);
  expect(result.state.processes.booking.draft.date).toBeUndefined();
});

test('Chat Lab real admin session executes published retail with isolated state', async ({ page }) => {
  await login(page, fixtures.labUser); await page.goto('/admin/chat-lab');
  await page.getByPlaceholder('Search businesses…').fill('E2E retail');
  await page.getByRole('button', { name: /E2E retail/ }).click();
  await page.getByPlaceholder('Write a customer message…').fill('E2E Shirt');
  const { result } = await readServerAction(page, () => page.getByRole('button', { name: 'Send ↑', exact: true }).click());
  expect(result.error).toBeUndefined(); expect(result.reply).toBe('size A?');
  expect(decode(result.session).state.visual.versionId).toBe(tenant('retail').versionA);
  await expect(page.getByRole('button', { name: 'Inspect agent response 1', exact: true }).getByText('size A?', { exact: true })).toBeVisible();
});

test.afterAll(() => {
  expect(sql('select (select count(*) from public.orders)+(select count(*) from public.order_submissions)+(select count(*) from public.bookings)+(select count(*) from public.messages)+(select count(*) from public.workflow_inbound_queue);')).toBe('0');
  // Test chat is intentionally sealed client state, never a live conversation.
  expect(sql('select count(*) from public.conversation_states;')).toBe('0');
});
