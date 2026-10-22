// Real local Auth, routed APIs, RLS and persisted history. Plans below are
// explicitly synthetic fixtures inserted through the same storage RPC, not AI output.
import { test, expect, chromium } from '@playwright/test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { verifyContainers, localKeys, work } from './local.mjs';
const fixture = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const tenant = fixture.tenants.find(t => t.kind === 'retail');
const other = fixture.tenants.find(t => t.kind === 'appointment');
const keys = localKeys();
const admin = createClient(keys.api, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });
const base = `/b/${tenant.slug}`;
const chat = page => page.locator('dialog.assistant-workspace-panel');
const log = page => chat(page).getByRole('log');
const history = page => page.getByRole('complementary', { name: /^Bisedat me / }).or(page.getByRole('dialog', { name: /^Bisedat me / }));
const region = page => page.getByRole('region', { name: 'Plani i veprimeve', exact: true });
const ids = [];
async function rpc(id, operation, revision = null, request = null, payload = {}) {
  const result = await admin.rpc('write_migo_conversation', { p_business: tenant.id, p_user: tenant.userId, p_id: id, p_operation: operation, p_revision: revision, p_request: request, p_payload: payload });
  if (result.error) throw result.error; return result.data;
}
async function seed(preview = false) {
  const id = randomUUID(), rid = randomUUID(), title = `Plan privat ${id.slice(0, 8)}`;
  ids.push(id); await rpc(id, 'create');
  await rpc(id, 'begin', 0, rid, { content: title, context: { page: 'home', entryPoint: 'home' }, fingerprint: createHash('sha256').update(title).digest('hex') });
  await rpc(id, 'finish', null, rid, { content: 'Propozim sintetik për kërkimin e produkteve; asnjë veprim nuk u krye.', snapshot: {
    version: 1, request: title, context: { page: 'home', entryPoint: 'home' },
    ...(preview ? { preview: { title: 'Ndryshim historik sintetik', subject: 'Produkt demonstrues', fields: [{ label: 'Emri', before: 'Para', after: 'Pas' }] } } : {}),
    actionPlan: { id: rid, request: title, assessedAt: '2000-01-01T00:00:00Z', questions: [], assumptions: [], steps: [{
      id: 'search', title: 'Kërkim produktesh', description: 'Përgjigje nga katalogu ekzistues.',
      requestedBehavior: 'Kërko produkte', requiredCapability: 'product.search', capabilityReadiness: 'ready', readiness: 'READY',
      missingConfiguration: [], requiredDecision: null, proposedAction: 'Vetëm plan', approvalRequired: true, supported: true, reasonCode: 'historical_fixture',
    }] },
  } });
  return { id, title };
}
async function guard(context) {
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === 'ws://localhost:3103' ? route.connectToServer() : route.close());
  await context.route('**/*', route => ['http://localhost:3103', keys.api].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort('blockedbyclient'));
}
async function login(page, who = tenant) {
  await page.goto('/login');
  await page.getByLabel('Email-i', { exact: true }).fill(who.email);
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103/b/${who.slug}`);
  await expect(chat(page).getByText('Po ngarkohet biseda…', { exact: true })).toHaveCount(0);
}
async function open(page, title) {
  await page.getByRole('button', { name: 'Historiku i asistentit', exact: true }).click();
  await expect(history(page)).toBeVisible();
  await history(page).getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await expect(log(page)).toContainText(title);
}
test.beforeAll(() => verifyContainers());
test.beforeEach(async ({ context, page }) => {
  await guard(context); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('agjenti-theme', 'dark'));
});
test.afterAll(async () => {
  for (const id of ids) {
    const r = await admin.from('migo_conversations').select('revision,deleted_at').eq('id', id).single();
    if (r.data && !r.data.deleted_at) await rpc(id, 'delete', r.data.revision);
  }
});
test('refresh, planning preferences, second device and mobile restore private server history without actions', async ({ page, browser }) => {
  const item = await seed(); let confirms = 0;
  page.on('request', r => { if (r.url().includes('/api/business-assistant?') && r.method() === 'POST' && r.postDataJSON()?.mode === 'confirm') confirms++; });
  await login(page); await open(page, item.title);
  await expect(chat(page)).toContainText('Plan i rikthyer — jo autorizim për ekzekutim');
  await expect(region(page)).toBeVisible();
  await region(page).getByRole('button', { name: 'Përfshi në plan', exact: true }).click();
  await expect(region(page)).toContainText('1 të përfshirë');
  await page.reload();
  await expect(log(page)).toContainText(item.title);
  await expect(region(page)).toContainText('1 të përfshirë');
  await expect(chat(page).getByRole('button', { name: 'Konfirmo ndryshimin', exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(work, 'ux3-desktop.png'), fullPage: false });
  const device = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await guard(device);
  const mobile = await device.newPage(); await mobile.addInitScript(() => localStorage.setItem('agjenti-theme', 'dark'));
  await login(mobile); await open(mobile, item.title);
  await expect(region(mobile)).toContainText('1 të përfshirë');
  await mobile.screenshot({ path: path.join(work, 'ux3-mobile.png'), fullPage: false });
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await device.close(); expect(confirms).toBe(0);
});
test('rename synchronizes; stale-tab deletion cannot resurrect the conversation', async ({ page, context }) => {
  const item = await seed(); await login(page); await open(page, item.title);
  const tab = await context.newPage(); await tab.goto(base);
  await expect(log(tab)).toContainText(item.title);
  await chat(page).getByRole('button', { name: 'Historiku i asistentit' }).click();
  await history(page).getByRole('button', { name: `Veprime për ${item.title}`, exact: true }).click();
  await history(page).getByRole('menuitem', { name: 'Riemërto', exact: true }).click();
  await history(page).getByLabel('Titulli i bisedës').fill('Plani i ri UX3');
  await history(page).getByRole('button', { name: 'Ruaj', exact: true }).click();
  await expect(history(page).getByRole('button', { name: 'Veprime për Plani i ri UX3', exact: true })).toBeVisible();
  await history(page).getByRole('button', { name: 'Veprime për Plani i ri UX3', exact: true }).click();
  await history(page).getByRole('menuitem', { name: 'Fshi', exact: true }).click();
  await history(page).getByRole('button', { name: 'Fshi përgjithmonë', exact: true }).click();
  await expect(history(page).getByRole('button', { name: 'Veprime për Plani i ri UX3', exact: true })).toHaveCount(0);
  await tab.bringToFront(); await tab.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(log(tab)).not.toContainText(item.title);
  await expect(chat(tab)).toContainText('Biseda nuk është më e disponueshme');
});
test('logout/login restores selection, while another owner never sees the private history', async ({ page }) => {
  const item = await seed(); await login(page); await open(page, item.title);
  await page.getByRole('button', { name: /^Menuja e profilit:/ }).click();
  await page.getByRole('menuitem', { name: 'Dil nga llogaria', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, other);
  await expect(log(page)).not.toContainText(item.title);
  const denied = await page.request.get(`/api/business-assistant/conversations?slug=${other.slug}&id=${item.id}`);
  expect(denied.status()).toBe(404);
  await page.context().clearCookies(); await login(page);
  await expect(log(page)).toContainText(item.title);
});
test('interrupted real AI route persists the user message and reports an unconfirmed result after refresh', async ({ page }) => {
  await login(page);
  await chat(page).getByRole('button', { name: 'Historiku i asistentit' }).click();
  await history(page).getByRole('button', { name: 'Bisedë e re', exact: true }).click();
  const text = `Kërkesë pa provider ${randomUUID().slice(0, 8)}`;
  await page.locator('#business-assistant-input').fill(text);
  await chat(page).getByRole('button', { name: 'Dërgo mesazhin', exact: true }).click();
  await expect(chat(page)).toContainText('Asistenti AI nuk është konfiguruar ende');
  await page.reload();
  await expect(log(page)).toContainText(text);
  await expect(log(page)).toContainText('Rezultat i pakonfirmuar');
  const list = await page.request.get(`/api/business-assistant/conversations?slug=${tenant.slug}`);
  const entry = (await list.json()).conversations.find(c => c.title === text); if (entry) ids.push(entry.id);
});
test('a delayed preference save cannot switch the active conversation back to an older one', async ({ page }) => {
  const first = await seed(), second = await seed();
  await login(page); await open(page, first.title);
  let release, arrived;
  const hold = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { arrived = resolve; });
  await page.route('**/api/business-assistant/conversations?*', async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON()?.mode !== 'preferences') return route.continue();
    const response = await route.fetch(); arrived(); await hold; await route.fulfill({ response });
  });
  await region(page).getByRole('button', { name: 'Përfshi në plan', exact: true }).click();
  await started;
  await open(page, second.title);
  const completed = page.waitForResponse(r => r.request().method() === 'POST' && r.request().postDataJSON()?.mode === 'preferences');
  release(); await completed;
  await expect(log(page)).toContainText(second.title);
  await expect(log(page)).not.toContainText(first.title);
  await page.reload();
  await expect(log(page)).toContainText(second.title);
});
test('a network interruption preserves server data and recovery never resubmits the action', async ({ page }) => {
  const item = await seed(); await login(page); await open(page, item.title);
  let writes = 0;
  await page.route('**/api/business-assistant/conversations?*', async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON()?.mode !== 'preferences') return route.continue();
    writes++; await route.fetch(); await route.abort('timedout');
  });
  await region(page).getByRole('button', { name: 'Përfshi në plan', exact: true }).click();
  await expect(region(page).getByRole('alert')).toBeVisible();
  await page.unroute('**/api/business-assistant/conversations?*');
  await page.reload();
  await expect(region(page)).toContainText('1 të përfshirë');
  expect(writes).toBe(1);
  await expect(chat(page).getByRole('button', { name: 'Konfirmo ndryshimin', exact: true })).toHaveCount(0);
});
test('an optional pre-restart checkpoint survives a fresh server and browser session', async ({ page }) => {
  test.skip(!process.env.MIGO_RESTART_CHECKPOINT, 'Run with an explicitly seeded local checkpoint before restarting the server.');
  const id = process.env.MIGO_RESTART_CHECKPOINT;
  ids.push(id);
  await login(page); await open(page, 'UX3 restart checkpoint');
  await expect(log(page)).toContainText('Mesazh i ruajtur para rinisjes së serverit.');
  const result = await page.request.get(`/api/business-assistant/conversations?slug=${tenant.slug}&id=${id}`);
  expect(result.status()).toBe(200);
  expect((await result.json()).messages).toHaveLength(2);
});
test('a recovered preview cannot confirm an old approval and cancellation survives refresh', async ({ page }) => {
  const item = await seed(true); await login(page); await open(page, item.title);
  await expect(chat(page).getByRole('button', { name: 'Konfirmo ndryshimin', exact: true })).toHaveCount(0);
  const preview = chat(page).getByRole('complementary', { name: 'Pamja e ndryshimit' });
  await expect(preview).toContainText('jo leje për veprim');
  await preview.getByRole('button', { name: 'Anulo', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.reload();
  await expect(chat(page)).not.toContainText('Plan i rikthyer — jo autorizim për ekzekutim');
  await expect(log(page)).toContainText('Mbylla propozimin pa ekzekutim.');
  await expect(chat(page).getByRole('complementary', { name: 'Pamja e ndryshimit' })).toHaveCount(0);
});
test('browser process restart restores the selected private conversation from the server', async () => {
  const item = await seed(), profile = mkdtempSync(path.join(work, 'ux3-browser-'));
  const options = { headless: true, baseURL: 'http://localhost:3103', viewport: { width: 1280, height: 900 } };
  let browserContext = await chromium.launchPersistentContext(profile, options);
  try {
    await guard(browserContext);
    let page = await browserContext.newPage();
    await login(page); await open(page, item.title);
    await browserContext.close();
    browserContext = await chromium.launchPersistentContext(profile, options);
    await guard(browserContext);
    page = await browserContext.newPage(); await page.goto(base);
    await expect(log(page)).toContainText(item.title);
    await expect(region(page)).toBeVisible();
  } finally {
    await browserContext.close();
    // Only the disposable Chromium profile created by this test; never user browser data.
    rmSync(profile, { recursive: true });
  }
});
