// Real isolated Auth and routed settings. AI responses below are explicitly
// synthetic UI fixtures; no provider, activation or publication is performed.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { work, verifyContainers, localKeys } from './local.mjs';

const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const retail = fixtures.tenants.find(t => t.kind === 'retail');
const other = fixtures.tenants.find(t => t.kind === 'appointment');
const keys = localKeys();
const base = `/b/${retail.slug}`;
const chat = page => page.locator('dialog.assistant-workspace-panel');
const input = page => page.locator('#business-assistant-input');
const profile = page => page.getByRole('button', { name: /^Menuja e profilit:/ });
const menu = page => page.getByRole('menu', { name: 'Menuja e profilit', exact: true });
const sections = page => page.getByRole('navigation', { name: 'Seksionet e cilësimeve', exact: true });
async function login(page, tenant = retail) {
  await page.goto('/login');
  await page.getByLabel('Email-i', { exact: true }).fill(tenant.email);
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(fixtures.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103${tenant.slug ? `/b/${tenant.slug}` : '/admin'}`);
}
async function settings(page, label = 'Cilësimet') {
  await profile(page).click();
  await menu(page).getByRole('menuitem', { name: label, exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103${base}/settings/profile`);
}
test.beforeAll(() => verifyContainers());
test.beforeEach(async ({ context, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await context.routeWebSocket('**/*', r => new URL(r.url()).origin === 'ws://localhost:3103' ? r.connectToServer() : r.close());
  await context.route('**/*', r => ['http://localhost:3103', keys.api].includes(new URL(r.request().url()).origin) ? r.continue() : r.abort('blockedbyclient'));
  await page.addInitScript(() => { if (!localStorage.getItem('agjenti-theme')) localStorage.setItem('agjenti-theme', 'dark'); });
});

test('compact shell, keyboard profile menu and routed settings preserve the one Asistenti AI instance', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Menuja e biznesit', exact: true });
  // Retail fixture explicitly omits the optional Customers module.
  expect(retail.modules).not.toContain('customers');
  expect(await nav.getByRole('link').allTextContents()).toEqual(['Asistenti AI', 'Bisedat', 'Aktiviteti', 'Biznesi']);
  await input(page).fill('Draft që mbetet gjatë navigimit');
  await chat(page).evaluate(el => { el.dataset.mountProof = 'persistent'; });
  await page.screenshot({ path: path.join(work, 'shell-after-desktop.png') });
  await profile(page).focus(); await page.keyboard.press('Enter');
  await expect(menu(page).getByRole('menuitem', { name: 'Profili', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu(page).getByRole('menuitem', { name: 'Dil nga llogaria', exact: true })).toBeFocused();
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown');
  await expect(menu(page).getByRole('menuitem', { name: 'Cilësimet', exact: true })).toBeFocused();
  await page.screenshot({ path: path.join(work, 'shell-profile-desktop.png') });
  await page.keyboard.press('Escape'); await expect(profile(page)).toBeFocused();
  await profile(page).click(); await page.locator('.dashboard-topbar').click({ position: { x: 750, y: 30 } });
  await expect(menu(page)).toHaveCount(0);
  await settings(page);
  await expect(page).toHaveURL(`http://localhost:3103${base}/settings/profile`);
  await expect(sections(page).getByRole('link', { name: 'Profili', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.account-details').getByText(retail.email, { exact: true })).toBeVisible();
  await expect(chat(page)).toHaveCount(1);
  await expect(chat(page)).toHaveAttribute('data-mount-proof', 'persistent');
  await page.screenshot({ path: path.join(work, 'shell-settings-desktop.png') });
  await page.getByRole('link', { name: '← Kthehu te asistenti', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103${base}`);
  await expect(input(page)).toHaveValue('Draft që mbetet gjatë navigimit');
  await expect(chat(page)).toHaveAttribute('data-mount-proof', 'persistent');
  await page.goBack();
  await expect(page).toHaveURL(`http://localhost:3103${base}/settings/profile`);
  await expect(sections(page)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(`http://localhost:3103${base}`);
  await expect(input(page)).toHaveValue('Draft që mbetet gjatë navigimit');
});

test('all settings sections use real content, legacy URLs and manual modules remain reachable', async ({ page }) => {
  await login(page); await settings(page);
  for (const [label, route, content] of [
    ['Preferencat', 'preferences', 'Gjuha / Language'],
    ['Profili i biznesit', 'business', 'Të dhënat e biznesit'],
    ['Paketa dhe përdorimi', 'billing', 'Kapaciteti i agjentit'],
    ['Asistenti yt', 'assistant', 'Asistenti yt, në stilin tënd.'],
    ['Modulet', 'modules', 'Modulet e hapësirës'],
    ['Aftësitë e biznesit', 'actions', 'Modulet e hapësirës'],
    ['Mjete të avancuara', 'advanced', 'Mjete të avancuara'],
  ]) {
    await sections(page).getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(`http://localhost:3103${base}/settings/${route}`);
    await expect(page.getByRole('heading', { name: content, exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Workflow Designer →', exact: true })).toBeVisible();
  for (const [old, target] of [['account', 'profile'], ['billing', 'billing'], ['actions', 'actions'], ['settings', 'profile']]) {
    await page.goto(`${base}/${old}`);
    await expect(page).toHaveURL(`http://localhost:3103${base}/settings/${target}`);
  }
  await page.getByRole('navigation', { name: 'Menuja e biznesit', exact: true }).getByRole('link', { name: 'Biznesi', exact: true }).click();
  const manual = page.getByRole('navigation', { name: 'Menaxhimi i biznesit', exact: true });
  for (const route of ['products', 'knowledge', 'orders']) {
    await expect(manual.locator(`a[href="${base}/${route}"]`)).toHaveCount(1);
  }
  for (const route of ['services', 'leads', 'customers']) await expect(manual.locator(`a[href="${base}/${route}"]`)).toHaveCount(0);
  await manual.getByText('Çfarë ofron biznesi', { exact: true }).click();
  await manual.locator(`a[href="${base}/products"]`).click();
  await expect(page.getByRole('checkbox', { name: 'Zgjidh E2E Shirt', exact: true })).toBeVisible();
});

test('Asistenti AI appearance is saved by the existing preference and survives reload without resetting chat', async ({ page }) => {
  await login(page); await input(page).fill('Draft personal');
  await settings(page);
  await sections(page).getByRole('link', { name: 'Asistenti yt', exact: true }).click();
  await page.getByLabel('Emri i asistentit', { exact: true }).fill('Luna');
  await page.getByRole('radio', { name: 'Mente', exact: true }).check();
  await page.getByRole('button', { name: 'Ruaj pamjen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pamja u ruajt' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Asistenti yt personal' })).toContainText('Luna');
  await page.getByRole('link', { name: '← Kthehu te asistenti', exact: true }).click();
  await expect(input(page)).toHaveValue('Draft personal');
  await page.goto(`${base}/settings/migo`);
  await expect(page.getByLabel('Emri i asistentit', { exact: true })).toHaveValue('Luna');
  await expect(page.getByRole('radio', { name: 'Mente', exact: true })).toBeChecked();
});

test('mobile menu contains profile, nested Escape restores focus and settings return to Asistenti AI', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.screenshot({ path: path.join(work, 'shell-after-mobile.png') });
  const toggle = page.getByRole('button', { name: 'Hap ose mbyll menunë', exact: true });
  await toggle.click(); await profile(page).click();
  await page.screenshot({ path: path.join(work, 'shell-profile-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(profile(page)).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Menuja kryesore', exact: true })).toBeVisible();
  await settings(page);
  await expect(page).toHaveURL(`http://localhost:3103${base}/settings/profile`);
  await expect(page.getByRole('dialog', { name: 'Menuja kryesore', exact: true })).toHaveCount(0);
  await page.getByText('Seksionet e cilësimeve', { exact: true }).click();
  await sections(page).getByRole('link', { name: 'Preferencat', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Pamja', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(work, 'shell-settings-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  for (const [label, route] of [
    ['Profili i biznesit', 'business'], ['Paketa dhe përdorimi', 'billing'], ['Asistenti yt', 'assistant'],
    ['Modulet', 'modules'], ['Aftësitë e biznesit', 'actions'], ['Mjete të avancuara', 'advanced'],
  ]) {
    await page.getByText('Seksionet e cilësimeve', { exact: true }).click();
    await sections(page).getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(`http://localhost:3103${base}/settings/${route}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBe(320);
  }
  await page.getByRole('link', { name: '← Kthehu te asistenti', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103${base}`);
  await expect(input(page)).toBeVisible();
  await toggle.click(); await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
});

test('foreign settings cannot be read and sign out uses real Auth', async ({ page }) => {
  await login(page);
  await page.goto(`/b/${other.slug}/settings/business`);
  await expect(page).toHaveURL(`http://localhost:3103${base}`);
  await expect(page.getByRole('heading', { name: other.name, exact: true })).toHaveCount(0);
  await profile(page).click(); await menu(page).getByRole('menuitem', { name: 'Dil nga llogaria', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3103/login');
  await page.goto(`${base}/settings/profile`);
  await expect(page).toHaveURL(/\/login/);
});

test('language and theme use existing preferences; the icon rail keeps profile reachable', async ({ page }) => {
  await login(page); await input(page).fill('Draft gjatë ndryshimit të gjuhës');
  await profile(page).click();
  await menu(page).getByRole('menuitem', { name: 'Gjuha / Language', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103${base}/settings/preferences#language`);
  await page.getByRole('radio', { name: 'Çelët', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-resolved', 'light');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Settings sections', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Business menu', exact: true })).toContainText('Conversations');
  await page.getByRole('link', { name: '← Back to assistant', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103${base}`);
  await expect(input(page)).toHaveValue('Draft gjatë ndryshimit të gjuhës');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-resolved', 'light');
  // Next's dev-only badge covers the bottom-left avatar in the 72px rail.
  // Remove only development chrome, never an application overlay.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.getByRole('button', { name: 'Show icons only', exact: true }).click();
  await expect(page.locator('.dashboard-sidebar')).toHaveCSS('width', '72px');
  await page.getByRole('button', { name: /^Profile menu:/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Profile', exact: true })).toBeVisible();
  const box = await page.getByRole('menu', { name: 'Profile menu', exact: true }).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1440);
  await page.screenshot({ path: path.join(work, 'shell-light-icon-rail.png') });
});

test('Asistenti AI settings report storage failure without changing the assistant identity', async ({ page }) => {
  await login(page); await settings(page);
  await sections(page).getByRole('link', { name: 'Asistenti yt', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103${base}/settings/assistant`);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('agjenti:personal-assistant:')) throw new DOMException('Synthetic storage denial', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByLabel('Emri i asistentit', { exact: true }).fill('Not saved');
  await page.getByRole('button', { name: 'Ruaj pamjen', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Shfletuesi nuk lejoi ruajtjen' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Asistenti yt personal' })).toContainText('Asistenti AI');
  await expect(page.getByText('Pamja u ruajt në këtë shfletues.', { exact: true })).toHaveCount(0);
});

test('settings navigation preserves pending approval without execution', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/business-assistant?*', route => {
    calls++;
    return route.fulfill({ json: { message: 'Plan sintetik, jo ekzekutim.', actionPlan: {
      id: 'shell-plan', request: 'Informo klientët', questions: [], assumptions: [], steps: [{
        id: 'knowledge', title: 'Përgjigje për klientët', description: 'Njohuritë aktive.', requestedBehavior: 'Informo',
        requiredCapability: 'knowledge.answer', capabilityReadiness: 'ready', readiness: 'READY',
        missingConfiguration: [], requiredDecision: null, proposedAction: 'Përfshije në plan.',
        approvalRequired: true, supported: true, reasonCode: 'verified_handler_and_configuration',
      }],
    } } });
  });
  await login(page); await input(page).fill('Përgatit planin');
  await chat(page).getByRole('button', { name: 'Dërgo mesazhin', exact: true }).click();
  await chat(page).getByRole('button', { name: 'Përfshi në plan', exact: true }).click();
  await settings(page);
  await page.getByRole('link', { name: '← Kthehu te asistenti', exact: true }).click();
  await expect(chat(page)).toContainText('Përfshirë vetëm në plan');
  expect(calls).toBe(1);
});

test('unsaved workflow warns on settings navigation and recovers the same revision', async ({ page }) => {
  await login(page); await page.goto(`${base}/workflows`);
  await page.getByRole('button', { name: 'Të gjithë hapat', exact: true }).click();
  await page.getByRole('button', { name: /^size ·/ }).focus(); await page.keyboard.press('Enter');
  await page.getByLabel('Emri i rrjedhës', { exact: true }).fill('Shell recovery draft');
  await profile(page).click();
  page.once('dialog', dialog => dialog.dismiss());
  await menu(page).getByRole('menuitem', { name: 'Cilësimet', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103${base}/workflows`);
  await expect(page.getByLabel('Emri i rrjedhës', { exact: true })).toHaveValue('Shell recovery draft');
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('Kopja lokale'); await dialog.accept(); });
  await menu(page).getByRole('menuitem', { name: 'Cilësimet', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103${base}/settings/profile`);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Rikthe ndryshimet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rikthe ndryshimet', exact: true }).click();
  await page.getByRole('button', { name: 'Të gjithë hapat', exact: true }).click();
  await page.getByRole('button', { name: /^size ·/ }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Emri i rrjedhës', { exact: true })).toHaveValue('Shell recovery draft');
});
