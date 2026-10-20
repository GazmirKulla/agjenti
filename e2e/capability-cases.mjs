// Real local Auth/PostgREST/PostgreSQL certification. Only the plan presented to
// the UI is a synthetic fixture; activation requests/responses are never mocked.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { work, verifyContainers, localKeys, sql } from './local.mjs';
import { quote, json } from './fixtures.mjs';

export function activationSuite(capability) {
test.describe(capability, () => {
const catalog = capability === 'product.search';
const table = catalog ? 'products' : 'knowledge_entries';
const moduleId = catalog ? 'products' : 'knowledge';
const configureLabel = 'Konfiguro';
const dialogTitle = catalog ? 'Bëje katalogun të kërkueshëm' : 'Aktivizo njohurinë për përgjigje';
const activateLabel = 'Konfirmo aktivizimin';
const consentLabel = catalog ? 'Miratoj që produkti i zgjedhur të bëhet i kërkueshëm për klientët.' : 'Miratoj që njohuria e zgjedhur të përdoret në përgjigjet për klientët.';
const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const owner = fixtures.tenants.find(t => t.kind === 'retail');
const foreign = fixtures.tenants.find(t => t.kind === 'quote');
const businessId = randomUUID(), productId = randomUUID();
const slug = `e2e-p2b-${businessId.slice(0, 8)}`;
const fault = `e2e_p2b_${businessId.slice(0, 8)}`;
const modules = ['products', 'knowledge', 'agents', 'settings'];
let keys, initialSideEffects;
let faultInstalled = false;
const endpoint = `/api/business-assistant/capability-activation?slug=${slug}`;
const origin = 'http://localhost:3103';
const profile = enabledModules => ({ version: 1, source: 'manual', enabledModules });
const row = () => JSON.parse(sql(`select row_to_json(p) from public.${table} p where id=${quote(productId)} and business_id=${quote(businessId)};`));
const sideEffects = () => sql(`select json_build_object('orders',(select count(*) from public.orders),'bookings',(select count(*) from public.bookings),'customers',(select count(*) from public.customers),'versions',(select count(*) from public.visual_workflow_versions),'messages',(select count(*) from public.messages));`);
function clearFault() {
  // Ordinary cases must not issue DDL when schema fault tests are excluded.
  if (!faultInstalled) return;
  sql(`drop trigger if exists ${fault} on public.${table}; drop function if exists public.${fault}();`);
  faultInstalled = false;
}
async function login(page, user = owner) {
  await page.goto('/login');
  await page.getByLabel('Email-i', { exact: true }).fill(user.email);
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(fixtures.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/b/'));
}
async function post(page, body, target = endpoint) {
  const response = await page.request.post(target, { headers: { origin }, data: { capability, ...body } });
  return { status: response.status(), body: await response.json() };
}
async function inspect(page) {
  const response = await post(page, { mode: 'inspect', capability });
  expect(response.status).toBe(200);
  return response.body;
}
async function ticket(page) {
  const inspected = await inspect(page);
  expect(inspected.status).toBe('available');
  const token = inspected.options.find(o => o.id === productId)?.token;
  expect(token).toBeTruthy();
  return token;
}
const confirm = (page, token) => post(page, { mode: 'confirm', token, approved: true });
function expired(token) {
  const [version, iv, tag, data] = token.split('.');
  expect(version).toBe('v1');
  const key = Buffer.from(fixtures.encryptionKey, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString());
  payload.expires = Date.now() - 1;
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
async function openCard(page) {
  // Synthetic *input* to the card, not a claimed real LLM response. The server
  // must independently assess/authorize every inspect and confirm below.
  await page.route('**/api/business-assistant?*', async route => {
    expect(route.request().postDataJSON().mode).toBe('plan');
    await route.fulfill({ json: { message: 'Synthetic Phase 2B plan fixture', actionPlan: {
      id: randomUUID(), request: 'Synthetic catalog discovery', assessedAt: new Date().toISOString(), questions: [], assumptions: [],
      steps: [{ id: 'activation', title: catalog ? 'Kërkim produktesh' : 'Përgjigje për klientët',
        description: catalog ? 'Kërkon produkte aktive.' : 'Përgjigjet nga njohuritë aktive.', requestedBehavior: catalog ? 'Kërko në katalog' : 'Përdor njohuritë e shqyrtuara',
        requiredCapability: capability, capabilityReadiness: 'needs_setup', readiness: 'NEEDS_CONFIGURATION', missingConfiguration: ['Konfigurim aktiv'],
        requiredDecision: null, proposedAction: 'Kontrollo konfigurimin', approvalRequired: true, supported: true, reasonCode: 'missing_requirements' }],
    } } });
  });
  await page.goto(`/b/${slug}`);
  const input = page.locator('textarea[name="assistant-message"]:visible').first();
  await input.fill('Synthetic Phase 2B plan fixture');
  await page.locator('dialog.assistant-workspace-panel').getByRole('button', { name: 'Dërgo mesazhin', exact: true }).click();
  await page.getByRole('button', { name: configureLabel, exact: true }).click();
  await expect(page.getByRole('region', { name: dialogTitle })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Phase 2B/ })).toBeEnabled();
}

test.beforeAll(() => {
  verifyContainers(); keys = localKeys();
  expect(sql('select (select count(*) from public.integrations)+(select count(*) from public.instagram_connections)+(select count(*) from public.whatsapp_connections)+(select count(*) from public.google_calendar_connections);')).toBe('0');
  initialSideEffects = sideEffects();
  sql(`begin;
    insert into public.businesses(id,name,slug,catalog_source,auto_reply,dashboard_profile) values(${quote(businessId)},'ZZ Synthetic Phase 2B',${quote(slug)},'internal',false,${json(profile(modules))});
    insert into public.business_users(business_id,user_id,role) values(${quote(businessId)},${quote(owner.userId)},'owner');
    ${catalog ? `insert into public.products(id,business_id,name,price_amount,currency,product_type_id,is_active) values(${quote(productId)},${quote(businessId)},'Phase 2B Product',20,'EUR',(select id from public.product_types where is_active order by id limit 1),false);` :
      `insert into public.knowledge_entries(id,business_id,title,body,is_active) values(${quote(productId)},${quote(businessId)},' Phase 2B Knowledge ','  Synthetic reviewed information.  ',false);`}
    commit;`);
});
test.beforeEach(async ({ page, context }) => {
  clearFault();
  sql(`begin;
    insert into public.business_users(business_id,user_id,role) values(${quote(businessId)},${quote(owner.userId)},'owner') on conflict(business_id,user_id) do update set role='owner';
    update public.businesses set dashboard_profile=${json(profile(modules))} where id=${quote(businessId)};
    update public.${table} set is_active=false,${catalog ? 'price_amount=20' : "body='  Synthetic reviewed information.  '"},updated_at=clock_timestamp() where id=${quote(productId)} and business_id=${quote(businessId)};
    commit;`);
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === 'ws://localhost:3103' ? route.connectToServer() : route.close({ code: 1008 }));
  await context.route('**/*', route => [origin, keys.api].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort('blockedbyclient'));
  await login(page);
});
test.afterEach(() => { clearFault(); expect(sideEffects()).toBe(initialSideEffects); });
test.afterAll(() => {
  clearFault();
  // Delete only this run's synthetic tenant; never reset the shared local stack.
  sql(`delete from public.businesses where id=${quote(businessId)} and slug=${quote(slug)};`);
});

test('real card → authenticated activation → database → reassessed card (synthetic plan input)', async ({ page }) => {
  await openCard(page);
  const configuration = page.getByRole('region', { name: dialogTitle, exact: true });
  await expect(configuration).toContainText('ZZ Synthetic Phase 2B');
  const before = row();
  const button = page.getByRole('button', { name: activateLabel, exact: true });
  await expect(button).toBeDisabled();
  await page.getByRole('radio', { name: /Phase 2B/ }).check();
  await expect(button).toBeDisabled();
  await page.screenshot({ path: path.join(work, `${moduleId}-activation-reviewed.png`), fullPage: true });
  await page.getByRole('checkbox', { name: consentLabel }).check();
  const saved = page.waitForResponse(r => r.url().includes('/capability-activation?') && r.request().postDataJSON()?.mode === 'confirm');
  await button.click();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'activated', changed: true, assessment: { status: 'ready' } });
  expect(row().is_active).toBe(true);
  expect(row()).toEqual({ ...before, is_active: true, updated_at: expect.any(String) });
  await expect(configuration).toContainText('U përfundua');
  await page.getByRole('button', { name: 'Kthehu te plani', exact: true }).click();
  await expect(page.locator('.action-plan-card')).toHaveAttribute('data-status', 'READY');
  await expect(page.locator('.action-plan-card')).toContainText('U përfundua');
  await expect(page.getByRole('button', { name: 'Përfshi në plan', exact: true })).toBeEnabled();
  await expect(page.getByText('0 të përfshirë · 0 të lënë jashtë · Asgjë e publikuar')).toBeVisible();
  await page.screenshot({ path: path.join(work, `${moduleId}-activation-ready.png`), fullPage: true });
});
test('mobile keyboard approval uses the same real writer and returns to the same plan', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCard(page);
  const configuration = page.getByRole('region', { name: dialogTitle, exact: true });
  await expect(configuration).toBeFocused();
  await expect(page.locator('dialog:modal')).toHaveCount(0); // Home is inline, not another modal.
  await configuration.getByRole('radio', { name: /Phase 2B/ }).focus();
  await page.keyboard.press('Space');
  await configuration.getByRole('checkbox', { name: consentLabel }).focus();
  await page.keyboard.press('Space');
  await configuration.getByRole('button', { name: activateLabel, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(configuration).toContainText('U përfundua');
  expect(row().is_active).toBe(true);
  await configuration.screenshot({ path: path.join(work, `ux2-${moduleId}-real-mobile.png`) });
  await configuration.getByRole('button', { name: 'Kthehu te plani', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Plani i veprimeve', exact: true })).toBeFocused();
  await expect(page.locator('.action-plan-card')).toContainText('U përfundua');
});
test('a stale reviewed record is rejected through the real UI without a retry button', async ({ page }) => {
  await openCard(page);
  await page.getByRole('radio', { name: /Phase 2B/ }).check();
  await page.getByRole('checkbox', { name: consentLabel }).check();
  sql(`update public.${table} set updated_at=clock_timestamp() where id=${quote(productId)} and business_id=${quote(businessId)};`);
  const before = row();
  await page.getByRole('button', { name: activateLabel, exact: true }).click();
  const configuration = page.getByRole('region', { name: dialogTitle, exact: true });
  await expect(configuration.getByRole('alert')).toContainText('ka ndryshuar ose është hequr');
  await expect(configuration.getByRole('button', { name: activateLabel, exact: true })).toHaveCount(0);
  expect(row()).toEqual(before);
  await configuration.getByRole('button', { name: 'Kthehu te plani', exact: true }).click();
  await expect(page.locator('.action-plan-card')).toContainText('Nuk u verifikua');
});
test('already active is read-only', async ({ page }) => {
  sql(`update public.${table} set is_active=true where id=${quote(productId)} and business_id=${quote(businessId)};`);
  const before = row(); expect(await inspect(page)).toMatchObject({ status: 'ready', changed: false }); expect(row()).toEqual(before);
});
test('incomplete configuration has no approval ticket', async ({ page }) => {
  sql(`update public.${table} set ${catalog ? 'price_amount=null' : "body=' '"} where id=${quote(productId)} and business_id=${quote(businessId)};`);
  const before = row(), result = await inspect(page);
  expect(result.status).toBe('blocked'); expect(result.options[0].token).toBeUndefined(); expect(row()).toEqual(before);
});
test('module OFF blocks inspection and a previously issued approval', async ({ page }) => {
  const token = await ticket(page);
  sql(`update public.businesses set dashboard_profile=${json(profile(modules.filter(m => m !== moduleId)))} where id=${quote(businessId)};`);
  expect(await inspect(page)).toMatchObject({ status: 'disabled' });
  expect((await confirm(page, token)).body).toMatchObject({ status: 'disabled', changed: false }); expect(row().is_active).toBe(false);
});
test('staff membership cannot activate, including after owner role is revoked', async ({ page }) => {
  const token = await ticket(page);
  sql(`update public.business_users set role='staff' where business_id=${quote(businessId)} and user_id=${quote(owner.userId)};`);
  expect(await inspect(page)).toMatchObject({ status: 'unauthorized' });
  expect((await confirm(page, token)).body).toMatchObject({ status: 'unauthorized', changed: false }); expect(row().is_active).toBe(false);
});
test('cross-tenant HTTP and real RLS reject foreign reads/writes', async ({ page }) => {
  const token = await ticket(page);
  expect((await post(page, { mode: 'confirm', token, approved: true }, `/api/business-assistant/capability-activation?slug=${owner.slug}`)).status).toBe(409);
  const client = createClient(keys.api, keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  expect((await client.auth.signInWithPassword({ email: foreign.email, password: fixtures.password })).error).toBeNull();
  const read = await client.from(table).select('id').eq('business_id', businessId);
  expect(read.data).toEqual([]);
  const write = await client.from(table).update({ is_active: true }).eq('id', productId).select('id');
  expect(write.data ?? []).toEqual([]); expect(row().is_active).toBe(false);
  await page.context().clearCookies(); await login(page, foreign);
  expect((await confirm(page, token)).status).toBe(403); expect(row().is_active).toBe(false);
});
test('stale record revision rejects approval', async ({ page }) => {
  const token = await ticket(page);
  sql(`update public.${table} set ${catalog ? 'price_amount=21' : "body='Changed after review'"},updated_at=clock_timestamp() where id=${quote(productId)} and business_id=${quote(businessId)};`);
  const before = row(); expect((await confirm(page, token)).status).toBe(409); expect(row()).toEqual(before);
});
test('expired encrypted approval is rejected', async ({ page }) => {
  const token = expired(await ticket(page)); const before = row();
  expect((await confirm(page, token)).status).toBe(409); expect(row()).toEqual(before);
});
test('replay is read-only; deactivate then replay is stale', async ({ page }) => {
  const token = await ticket(page); expect((await confirm(page, token)).body.status).toBe('activated');
  const active = row(); expect((await confirm(page, token)).body).toMatchObject({ status: 'ready', changed: false }); expect(row()).toEqual(active);
  sql(`update public.${table} set is_active=false,updated_at=clock_timestamp() where id=${quote(productId)} and business_id=${quote(businessId)};`);
  const inactive = row(); expect((await confirm(page, token)).status).toBe(409); expect(row()).toEqual(inactive);
});
test('two concurrent authenticated confirmations produce one successful transition', async ({ page }) => {
  const token = await ticket(page), before = row();
  const results = await Promise.all([confirm(page, token), confirm(page, token)]);
  expect(results.filter(r => r.status === 200 && r.body.changed === true)).toHaveLength(1);
  expect(results.every(r => r.status === 409 || r.status === 200 && ['ready', 'activated'].includes(r.body.status))).toBe(true);
  expect(row().is_active).toBe(true); expect(row().updated_at).not.toBe(before.updated_at);
});
test('cancelling the real dialog never submits activation or changes the row', async ({ page }) => {
  let confirmations = 0;
  page.on('request', r => { if (r.url().includes('/capability-activation?') && r.postDataJSON()?.mode === 'confirm') confirmations++; });
  const before = row(); await openCard(page);
  await page.getByRole('radio', { name: /Phase 2B/ }).check();
  await page.getByRole('button', { name: 'Anulo dhe kthehu te plani', exact: true }).click();
  await expect(page.getByRole('region', { name: dialogTitle })).not.toBeVisible();
  expect(confirmations).toBe(0); expect(row()).toEqual(before);
});
test('real PostgreSQL failure rolls back activation; retry after recovery succeeds', async ({ page }) => {
  const token = await ticket(page), before = row();
  faultInstalled = true; // Also clean up if installation fails partway through.
  sql(`create function public.${fault}() returns trigger language plpgsql as $$ begin if new.id=${quote(productId)}::uuid then raise exception 'synthetic_activation_failure'; end if; return new; end $$;
    revoke all on function public.${fault}() from public;
    create trigger ${fault} before update on public.${table} for each row execute function public.${fault}();`);
  expect((await confirm(page, token)).status).toBe(409); expect(row()).toEqual(before);
  clearFault(); expect((await confirm(page, token)).body.status).toBe('activated'); expect(row().is_active).toBe(true);
});
test('successful database write followed by failed reassessment is not reported ready', async ({ page }) => {
  const token = await ticket(page);
  faultInstalled = true;
  // Scoped real DB fault: revoke this synthetic membership only after its row commits.
  sql(`create function public.${fault}() returns trigger language plpgsql as $$ begin
    if new.id=${quote(productId)}::uuid then delete from public.business_users where business_id=${quote(businessId)}::uuid and user_id=${quote(owner.userId)}::uuid; end if; return new; end $$;
    revoke all on function public.${fault}() from public;
    create trigger ${fault} after update on public.${table} for each row execute function public.${fault}();`);
  const result = await confirm(page, token);
  expect(result.status).toBe(200); expect(result.body).toMatchObject({ status: 'unverified', changed: true }); expect(result.body.assessment).toBeUndefined(); expect(row().is_active).toBe(true);
});
if (!catalog) test('existing manual Knowledge editor still saves without requiring chat', async ({ page }) => {
  await page.goto(`/b/${slug}/knowledge`);
  const form = page.locator('form.detail-block');
  await form.getByLabel('Titulli', { exact: true }).fill('  Phase 2B manual title  ');
  await form.getByLabel(/^Përmbajtja/).fill('  Manually reviewed synthetic information.  ');
  await form.getByRole('checkbox', { name: 'Përdore në përgjigjet e Agjentit' }).check();
  await form.getByRole('button', { name: 'Ruaj ndryshimet', exact: true }).click();
  await expect(form.getByText('Njohuria u ruajt.', { exact: true })).toBeVisible();
  expect(row()).toMatchObject({ title: 'Phase 2B manual title', body: 'Manually reviewed synthetic information.', is_active: true });
});
if (!catalog) test('long valid Unicode knowledge activates without rewriting its content', async ({ page }) => {
  const body = 'ë'.repeat(4000);
  sql(`update public.knowledge_entries set body=${quote(body)},updated_at=clock_timestamp() where id=${quote(productId)} and business_id=${quote(businessId)};`);
  const token = await ticket(page), result = await confirm(page, token);
  expect(result.status).toBe(200); expect(result.body.status).toBe('activated');
  expect(row()).toMatchObject({ body, is_active: true });
});
});
}
