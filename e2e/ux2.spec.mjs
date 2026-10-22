// Real local Auth/navigation; explicitly synthetic AI plans and activation responses.
// Real authorized writes, expiry, revisions and replay run in capability-cases.mjs.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { work, verifyContainers, localKeys } from './local.mjs';

const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const retail = fixtures.tenants.find(t => t.kind === 'retail');
const appointment = fixtures.tenants.find(t => t.kind === 'appointment');
const keys = localKeys();
const chat = page => page.locator('dialog.assistant-workspace-panel');
const plan = page => page.getByRole('region', { name: 'Plani i veprimeve', exact: true });
const configuration = page => page.getByRole('region', { name: 'Bëje katalogun të kërkueshëm', exact: true });
const step = (id, key, readiness = 'READY') => ({
  id, title: key === 'product.search' ? 'Kërkim produktesh' : key === 'customer.create' ? 'Regjistrimi i klientit' : 'Përgatitja e porosisë',
  description: key === 'order.prepare' ? 'Përgatit të dhënat për stafin; nuk krijon porosi.' : 'Ndihmojmë klientët me informacionin e biznesit.',
  requestedBehavior: id, requiredCapability: key, capabilityReadiness: readiness === 'READY' ? 'ready' : 'needs_setup', readiness,
  missingConfiguration: readiness === 'NEEDS_CONFIGURATION' ? ['Duhet të paktën një produkt aktiv.'] : [],
  requiredDecision: null, proposedAction: 'Përfshije vetëm në plan.', approvalRequired: key !== 'customer.create',
  supported: key !== 'customer.create', reasonCode: 'synthetic_ui_fixture',
});
const available = { status: 'available', changed: false, message: 'Zgjidh produktin që dëshiron të aktivizosh.',
  options: [{ id: 'synthetic-record', name: 'Produkt UX-2', price: 20, currency: 'EUR', token: 'synthetic-ui-ticket' }] };
const ready = { capabilityKey: 'product.search', status: 'ready', availability: 'ready', reasonCode: 'verified_handler_and_configuration', missingRequirements: [] };
async function login(page, user = retail) {
  await page.goto('/login');
  await page.getByLabel('Email-i', { exact: true }).fill(user.email);
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(fixtures.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  await expect(page).toHaveURL(/\/(b\/|admin)/);
  await page.goto(`/b/${retail.slug}`);
}
async function showPlan(page, steps, user) {
  await page.route('**/api/business-assistant?*', route => route.fulfill({ json: {
    message: 'Le t’i përgatisim hapat një nga një.',
    actionPlan: { id: 'ux2-guided', request: 'Porosi nga Instagram', assessedAt: new Date().toISOString(), questions: [], assumptions: [], steps },
  } }));
  await login(page, user);
  await page.locator('#business-assistant-input').fill('Dua që agjenti të marrë porosi nga Instagram.');
  await chat(page).getByRole('button', { name: 'Dërgo mesazhin', exact: true }).click();
  await expect(plan(page)).toBeVisible();
}
test.beforeAll(() => verifyContainers());
test.beforeEach(async ({ context }) => {
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === 'ws://localhost:3103' ? route.connectToServer() : route.close());
  await context.route('**/*', route => ['http://localhost:3103', keys.api].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort('blockedbyclient'));
});

test('one focused decision, partial supported plan, keyboard and navigation without execution', async ({ page }) => {
  let activations = 0;
  await page.route('**/api/business-assistant/capability-activation?*', route => { activations++; return route.abort(); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await showPlan(page, [step('product', 'product.search'), step('order', 'order.prepare'), step('customer', 'customer.create', 'UNSUPPORTED')]);
  await expect(plan(page).getByRole('article')).toHaveCount(1);
  await expect(plan(page).locator('.action-plan-blocker').getByText('Nuk mbështetet', { exact: true })).toBeVisible();
  await expect(plan(page).getByText('product.search', { exact: true })).not.toBeVisible();
  await expect(plan(page).getByRole('button', { name: /Publiko/ })).toHaveCount(0);
  await expect(plan(page).getByRole('heading', { name: 'Ta përgatisim bashkë' })).toBeInViewport();
  await page.screenshot({ path: path.join(work, 'ux2-plan-desktop.png') });
  await plan(page).getByRole('button', { name: 'Përfshi në plan', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(plan(page).getByRole('article')).toContainText('Përfshirë vetëm në plan');
  await expect(plan(page).getByRole('article')).not.toContainText('U përfundua');
  await page.getByRole('textbox', { name: 'Kërko faqe', exact: true }).fill('Produkte');
  await page.locator(`.search-results a[href="/b/${retail.slug}/products"]`).first().click();
  await page.getByRole('button', { name: 'Pyet Asistenti AI për produktet', exact: true }).click();
  await expect(plan(page).getByRole('article')).toContainText('Përfshirë vetëm në plan');
  await plan(page).getByRole('button', { name: 'Hapi tjetër', exact: true }).click();
  await expect(plan(page).getByRole('article')).toContainText('Përgatitja e porosisë');
  await plan(page).getByText('Hapi 2 nga 3 · Shiko hapat', { exact: true }).click();
  await plan(page).getByRole('button', { name: 'Regjistrimi i klientit Nuk mbështetet', exact: true }).click();
  await expect(plan(page).getByRole('article')).toContainText('nuk krijon një klient në CRM');
  await expect(plan(page).getByRole('button', { name: 'Përfshi në plan', exact: true })).toHaveCount(0);
  await expect(plan(page).getByRole('button', { name: 'Konfiguro', exact: true })).toHaveCount(0);
  await plan(page).getByRole('button', { name: 'Kërko alternativë', exact: true }).click();
  await plan(page).getByLabel('Çfarë dëshiron të ndryshosh?').fill('Vazhdo vetëm me pjesën e mbështetur.');
  await plan(page).getByRole('button', { name: 'Vazhdo në chat', exact: true }).click();
  await expect(page.locator('#business-assistant-input')).toBeFocused();
  await expect(page.locator('#business-assistant-input')).toHaveValue(/pa ruajtur ose aktivizuar asgjë/);
  expect(activations).toBe(0);
});

test('mobile inline configuration has one modal, stable target, consent and cancel focus', async ({ page }) => {
  const modes = [];
  await page.route('**/api/business-assistant/capability-activation?*', route => {
    modes.push(route.request().postDataJSON().mode);
    return route.fulfill({ json: available });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('agjenti-theme', 'dark'));
  await showPlan(page, [step('product', 'product.search', 'NEEDS_CONFIGURATION')]);
  await expect(page.locator('html')).toHaveAttribute('data-resolved', 'dark');
  await expect.poll(() => page.evaluate(() => {
    const heading = document.querySelector('.action-plan-heading').getBoundingClientRect();
    const header = document.querySelector('.dashboard-topbar').getBoundingClientRect();
    return heading.top >= header.bottom;
  })).toBe(true); // The sticky mobile header must not cover the new decision.
  await page.screenshot({ path: path.join(work, 'ux2-plan-mobile-dark.png') });
  // Move the same plan to the contextual mobile dialog.
  await page.getByRole('button', { name: 'Hap ose mbyll menunë' }).click();
  await page.getByRole('dialog', { name: 'Menuja kryesore' }).getByRole('link', { name: 'Biznesi', exact: true }).click();
  await page.getByText('Çfarë ofron biznesi', { exact: true }).click();
  await page.getByRole('link', { name: /Produkte/ }).first().click();
  await page.getByRole('button', { name: 'Pyet Asistenti AI për produktet', exact: true }).click();
  await plan(page).getByRole('button', { name: 'Konfiguro', exact: true }).click();
  await expect(configuration(page)).toBeFocused();
  await expect(configuration(page)).toContainText(retail.name);
  await expect(page.locator('dialog:modal')).toHaveCount(1);
  const confirm = configuration(page).getByRole('button', { name: 'Konfirmo aktivizimin', exact: true });
  await expect(confirm).toBeDisabled();
  await configuration(page).getByRole('radio').focus(); await page.keyboard.press('Space');
  await expect(confirm).toBeDisabled();
  await configuration(page).getByRole('checkbox').check();
  await expect(confirm).toBeEnabled();
  await expect(configuration(page)).toContainText('Gati për konfirmim');
  await expect(configuration(page)).toContainText('Do të aktivizohet: Produkt UX-2');
  await configuration(page).screenshot({ path: path.join(work, 'ux2-config-mobile-dark.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.keyboard.press('Escape');
  await expect(configuration(page)).toHaveCount(0);
  await expect(plan(page)).toBeFocused();
  await expect(chat(page)).toBeVisible();
  expect(modes.every(mode => mode === 'inspect')).toBe(true);
});

for (const [name, response] of [
  ['failed reassessment', { status: 'unverified', changed: true, message: 'Rivlerësimi dështoi.' }],
  ['HTTP success without evidence', { status: 'activated', changed: true, message: 'U aktivizua.' }],
  ['mismatched assessment', { status: 'activated', changed: true, message: 'U aktivizua.', assessment: { ...ready, capabilityKey: 'knowledge.answer' } }],
]) test(`${name}: never shows success or retries a confirmation blindly`, async ({ page }) => {
  let confirmations = 0;
  await page.route('**/api/business-assistant/capability-activation?*', route => {
    if (route.request().postDataJSON().mode === 'inspect') return route.fulfill({ json: available });
    confirmations++; return route.fulfill({ json: response });
  });
  await showPlan(page, [step('product', 'product.search', 'NEEDS_CONFIGURATION')]);
  await plan(page).getByRole('button', { name: 'Konfiguro', exact: true }).click();
  await configuration(page).getByRole('radio').check();
  await configuration(page).getByRole('checkbox').check();
  await configuration(page).getByRole('button', { name: 'Konfirmo aktivizimin', exact: true }).click();
  await expect(configuration(page)).toContainText('Nuk u verifikua');
  await expect(configuration(page)).toContainText('Ndryshimi mund të jetë ruajtur');
  await expect(configuration(page)).not.toContainText('U përfundua');
  await expect(configuration(page).getByRole('button', { name: 'Konfirmo aktivizimin', exact: true })).toHaveCount(0);
  await configuration(page).getByRole('button', { name: 'Kthehu te plani', exact: true }).click();
  await expect(plan(page).getByRole('article')).toContainText('Nuk u verifikua');
  await expect(plan(page).getByRole('button', { name: 'Përfshi në plan', exact: true })).toHaveCount(0);
  expect(confirmations).toBe(1);
});

test('pending configuration does not transfer to another authorized tenant', async ({ page }) => {
  const requests = [];
  await page.route('**/api/business-assistant/capability-activation?*', route => {
    requests.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ json: available });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await showPlan(page, [step('product', 'product.search', 'NEEDS_CONFIGURATION')], fixtures.labUser);
  await plan(page).getByRole('button', { name: 'Konfiguro', exact: true }).click();
  await configuration(page).getByRole('radio').check();
  await configuration(page).getByRole('checkbox').check();
  await page.locator('.workspace-picker > summary').click();
  await page.locator(`.workspace-options a[href="/b/${appointment.slug}"]`).click();
  await expect(page).toHaveURL(`http://localhost:3103/b/${appointment.slug}`);
  await expect(plan(page)).toHaveCount(0);
  await expect(configuration(page)).toHaveCount(0);
  expect(requests.every(request => request.url.endsWith(`slug=${retail.slug}`) && request.body.mode === 'inspect')).toBe(true);
});

test('pending confirmation locks duplicate clicks and cancellation; only verified result completes', async ({ page }) => {
  let confirmations = 0, finish;
  await page.route('**/api/business-assistant/capability-activation?*', async route => {
    if (route.request().postDataJSON().mode === 'inspect') return route.fulfill({ json: available });
    confirmations++;
    await new Promise(resolve => { finish = resolve; });
    await route.fulfill({ json: { status: 'activated', changed: true, message: 'Produkt UX-2 u aktivizua.', assessment: ready } });
  });
  await showPlan(page, [step('product', 'product.search', 'NEEDS_CONFIGURATION')]);
  await plan(page).getByRole('button', { name: 'Konfiguro', exact: true }).click();
  await configuration(page).getByRole('radio').check();
  await configuration(page).getByRole('checkbox').check();
  const confirm = configuration(page).getByRole('button', { name: 'Konfirmo aktivizimin', exact: true });
  await confirm.dblclick();
  await expect(confirm).toBeDisabled();
  await expect(configuration(page)).toContainText('Duke u kryer');
  await expect(configuration(page).getByRole('button', { name: 'Anulo dhe kthehu te plani', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(configuration(page)).toBeVisible();
  expect(confirmations).toBe(1);
  finish();
  await expect(configuration(page)).toContainText('U përfundua');
  await expect(configuration(page)).toContainText('Rekordi i shqyrtuar: Produkt UX-2');
});

test('lost confirmation response stays uncertain and cannot resubmit the old ticket', async ({ page }) => {
  let confirmations = 0;
  await page.route('**/api/business-assistant/capability-activation?*', route => {
    if (route.request().postDataJSON().mode === 'inspect') return route.fulfill({ json: available });
    confirmations++; return route.abort('connectionclosed');
  });
  await showPlan(page, [step('product', 'product.search', 'NEEDS_CONFIGURATION')]);
  await plan(page).getByRole('button', { name: 'Konfiguro', exact: true }).click();
  await configuration(page).getByRole('radio').check();
  await configuration(page).getByRole('checkbox').check();
  await configuration(page).getByRole('button', { name: 'Konfirmo aktivizimin', exact: true }).click();
  await expect(configuration(page)).toContainText('Ndryshimi mund të jetë ruajtur');
  await expect(configuration(page).getByRole('alert')).toHaveText('Rezultati nuk u konfirmua. Rihap kontrollin para riprovimit.');
  await expect(configuration(page).getByRole('button', { name: 'Konfirmo aktivizimin', exact: true })).toHaveCount(0);
  await configuration(page).getByRole('button', { name: 'Kthehu te plani', exact: true }).click();
  await expect(plan(page).getByRole('article')).toContainText('Produkt UX-2: Ndryshimi mund të jetë ruajtur');
  expect(confirmations).toBe(1);
});
