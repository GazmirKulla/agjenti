import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { work, verifyContainers, localKeys } from './local.mjs';

// Real isolated Auth/dashboard. No provider requests or business mutations.
const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const tenant = fixtures.tenants.find(item => item.kind === 'retail');
const keys = localKeys();
const widget = page => page.getByRole('region', { name: 'Asistenti yt personal' });
const settings = page => page.getByRole('dialog', { name: 'Asistenti yt, në stilin tënd.' });

async function login(page, user = tenant) {
  await page.goto('/login');
  await page.getByLabel('Email-i', { exact: true }).fill(user.email);
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(fixtures.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103/b/${user.slug}`);
}
test.beforeAll(() => verifyContainers());
test.beforeEach(async ({ context }) => {
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === 'ws://localhost:3103' ? route.connectToServer() : route.close());
  await context.route('**/*', route => ['http://localhost:3103', keys.api].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort('blockedbyclient'));
});

test('desktop: original avatar, local customization, cancellation and existing chat navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await expect(widget(page)).toContainText('Migo');
  await expect(widget(page)).toContainText('Gati për të ndihmuar');
  await expect(widget(page).locator('svg.assistant-robot')).toHaveCSS('width', '48px');
  await expect(page.locator('.personal-assistant-widget')).toHaveCount(1);
  await expect(page.locator('.assistant-desktop-trigger')).toHaveCount(0);
  await expect(page.locator('.dashboard-topbar').getByRole('region', { name: 'Asistenti yt personal' })).toBeVisible();
  expect((await widget(page).boundingBox()).y).toBeLessThan(80);
  await expect(widget(page).locator('.personal-assistant-avatar')).toHaveCSS('animation-name', 'none');
  await expect(widget(page).getByRole('button', { name: /call|telefono/i })).toHaveCount(0);
  await page.screenshot({ path: path.join(work, 'widget-desktop-light.png') });
  await page.evaluate(() => localStorage.setItem('agjenti-theme', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-resolved', 'dark');
  await expect(widget(page)).toBeVisible();
  await page.screenshot({ path: path.join(work, 'widget-desktop-dark.png') });
  await widget(page).getByRole('button', { name: 'Personalizo asistentin' }).click();
  await settings(page).getByLabel('Emri i asistentit').fill('Luna');
  await settings(page).getByRole('radio', { name: 'Jargavan' }).check();
  await page.screenshot({ path: path.join(work, 'widget-settings-desktop.png') });
  await settings(page).getByRole('button', { name: 'Ruaj pamjen' }).click();
  await expect(widget(page)).toContainText('Luna');
  await page.reload();
  await expect(widget(page)).toContainText('Luna');
  await expect(widget(page).locator('.personal-assistant-avatar')).toHaveAttribute('data-avatar', 'lilac');
  await widget(page).getByRole('button', { name: 'Personalizo asistentin' }).click();
  await settings(page).getByLabel('Emri i asistentit').fill('Not saved');
  await settings(page).getByRole('button', { name: 'Anulo' }).click();
  await expect(widget(page)).toContainText('Luna');
  await widget(page).getByRole('button', { name: 'Hap bisedën me Luna' }).click();
  const chat = page.getByRole('dialog', { name: 'Luna', exact: true });
  await expect(chat).toBeVisible();
  await expect(chat.locator('#business-assistant-input')).toBeVisible();
  await expect(widget(page)).toHaveCount(0); // hidden, not a second conversation
  await chat.getByRole('button', { name: 'Mbyll bisedën' }).click();
  await expect(widget(page)).toBeVisible();
});

test('mobile: one header assistant, accessible settings, narrow layout and the existing conversation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const inlineChat = page.locator('.assistant-inline-home');
  await expect(inlineChat).toBeVisible();
  await expect(widget(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Personalizo asistentin', exact: true })).toHaveCount(1);
  await widget(page).getByRole('button', { name: 'Personalizo asistentin', exact: true }).click();
  await settings(page).getByLabel('Emri i asistentit').fill('Migo');
  await settings(page).getByRole('radio', { name: 'Blu', exact: true }).check();
  await page.screenshot({ path: path.join(work, 'widget-settings-mobile.png') });
  await settings(page).getByRole('button', { name: 'Ruaj pamjen' }).click();
  await page.goto(`/b/${tenant.slug}/business`);
  await expect(widget(page)).toBeVisible();
  const card = await widget(page).boundingBox();
  const dock = await page.locator('.assistant-mobile-dock').boundingBox();
  expect(card.y + card.height).toBeLessThanOrEqual(dock.y);
  expect(card.y).toBeLessThan(140);
  await expect(page.locator('.personal-assistant-widget')).toHaveCount(1);
  await page.screenshot({ path: path.join(work, 'widget-mobile-light.png') });
  await page.evaluate(() => localStorage.setItem('agjenti-theme', 'dark'));
  await page.reload();
  await expect(widget(page)).toBeVisible();
  await page.screenshot({ path: path.join(work, 'widget-mobile-dark.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(widget(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await widget(page).getByRole('button', { name: 'Personalizo asistentin' }).click();
  await settings(page).getByLabel('Emri i asistentit').fill('A very long assistant name 123456');
  await settings(page).getByRole('button', { name: 'Ruaj pamjen' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await widget(page).getByRole('button', { name: /^Hap bisedën/ }).click();
  await expect(page.locator('#business-assistant-input')).toBeVisible();
  await page.getByRole('dialog', { name: /^A very long/ }).getByRole('button', { name: 'Personalizo asistentin' }).click();
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
  await expect(page.locator('#business-assistant-input')).toBeVisible();
});

test('activity reflects the existing request and approval; reopening never sends or confirms again', async ({ page, context }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  let release;
  let calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  // Synthetic API response tests UI projection only, not AI/provider execution.
  await page.route('**/api/business-assistant?*', async route => {
    calls++;
    expect(route.request().postDataJSON().mode).toBe('plan');
    await pending;
    await route.fulfill({ json: { message: 'Propozim sintetik për provën UI.', token: 'synthetic-ui-only',
      preview: { title: 'Ndryshim sintetik', fields: [{ label: 'Emri', before: 'A', after: 'B' }] } } });
  });
  await login(page);
  await widget(page).getByRole('button', { name: 'Hap bisedën me Migo' }).click();
  await page.locator('#business-assistant-input').fill('Përgatit një ndryshim sintetik');
  await page.getByRole('dialog', { name: 'Migo', exact: true }).getByRole('button', { name: 'Dërgo mesazhin', exact: true }).click();
  await page.getByRole('button', { name: 'Mbyll bisedën' }).click();
  await expect(widget(page)).toContainText('Po punon…');
  release();
  await expect(widget(page)).toContainText('Pret konfirmimin tënd');
  await widget(page).getByRole('button', { name: 'Hap bisedën me Migo' }).click();
  await expect(page.getByRole('button', { name: 'Konfirmo ndryshimin', exact: true })).toBeVisible();
  expect(calls).toBe(1);
  await page.getByRole('button', { name: 'Anulo', exact: true }).click();
  await page.getByRole('button', { name: 'Mbyll bisedën' }).click();
  await expect(widget(page)).toContainText('Gati për të ndihmuar');
  await context.setOffline(true);
  await expect(widget(page)).toContainText('Pa lidhje');
  await context.setOffline(false);
  await expect(widget(page)).toContainText('Gati për të ndihmuar');
  expect(calls).toBe(1);
});

test('cosmetic preferences do not leak to a different authenticated owner/tenant or call configuration APIs', async ({ page, context }) => {
  let mutations = 0;
  page.on('request', request => { if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/')) mutations++; });
  await login(page);
  await widget(page).getByRole('button', { name: 'Personalizo asistentin' }).click();
  await settings(page).getByLabel('Emri i asistentit').fill('Vetëm për mua');
  await settings(page).getByRole('button', { name: 'Ruaj pamjen' }).click();
  const afterSettings = mutations;
  expect(afterSettings).toBe(0);
  await context.clearCookies(); // Same browser/storage, a different real authenticated owner.
  await login(page, fixtures.tenants.find(item => item.kind === 'quote'));
  await expect(widget(page)).toContainText('Migo');
  await expect(widget(page)).not.toContainText('Vetëm për mua');
  await context.clearCookies();
  await login(page);
  await expect(widget(page)).toContainText('Vetëm për mua');
});

test('unavailable browser storage reports failure and never claims settings were saved', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('agjenti:personal-assistant:')) throw new DOMException('Storage denied', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await login(page);
  await widget(page).getByRole('button', { name: 'Personalizo asistentin' }).click();
  await settings(page).getByLabel('Emri i asistentit').fill('Unsaved');
  await settings(page).getByRole('button', { name: 'Ruaj pamjen' }).click();
  await expect(settings(page).getByRole('alert')).toContainText('Cilësimet nuk u ndryshuan');
  await settings(page).getByRole('button', { name: 'Anulo' }).click();
  await expect(widget(page)).toContainText('Migo');
});

test('the saved name reaches every conversation request after reload, a new chat and a rename', async ({ page }) => {
  const requests = [];
  // UI transport test; the real route → planner prompt is verified in Vitest.
  await page.route('**/api/business-assistant?*', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    await route.fulfill({ json: { message: `Përgjigje sintetike: ${body.assistantName}.` } });
  });
  await login(page);
  await widget(page).getByRole('button', { name: 'Personalizo asistentin' }).click();
  await settings(page).getByLabel('Emri i asistentit').fill('Luna');
  await settings(page).getByRole('button', { name: 'Ruaj pamjen' }).click();
  await page.reload();
  await widget(page).getByRole('button', { name: 'Hap bisedën me Luna' }).click();
  const input = page.locator('#business-assistant-input');
  await input.fill('Si e ke emrin?'); await input.press('Enter');
  await expect(page.getByRole('log')).toContainText('Përgjigje sintetike: Luna.');
  await page.getByRole('button', { name: 'Bisedë e re', exact: true }).click();
  await input.fill('Kush je ti?'); await input.press('Enter');
  await expect(page.getByRole('log')).toContainText('Përgjigje sintetike: Luna.');
  expect(requests.map(body => body.assistantName)).toEqual(['Luna', 'Luna']);
  expect(requests[1].history).toEqual([]);
  await page.getByRole('dialog', { name: 'Luna', exact: true }).getByRole('button', { name: 'Personalizo asistentin' }).click();
  await settings(page).getByLabel('Emri i asistentit').fill('Migo');
  await settings(page).getByRole('button', { name: 'Ruaj pamjen' }).click();
  await input.fill('Po tani si quhesh?'); await input.press('Enter');
  await expect(page.getByRole('log')).toContainText('Përgjigje sintetike: Migo.');
  expect(requests[2].assistantName).toBe('Migo');
  expect(requests[2].history).toContainEqual({ role: 'assistant', content: 'Përgjigje sintetike: Luna.' });
  await page.getByRole('button', { name: 'Mbyll bisedën' }).click();
  await expect(widget(page)).toContainText('Migo');
  await expect(page.locator('.assistant-home-identity')).toContainText('Migo');
});
