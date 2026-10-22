// Real local Auth/PostgREST. Stored messages below are labeled synthetic fixtures.
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { localKeys, verifyContainers, work } from './local.mjs';
const f = JSON.parse(readFileSync(`${work}/fixtures.json`, 'utf8'));
const tenant = f.tenants.find(t => t.kind === 'retail');
const keys = localKeys(), base = `/b/${tenant.slug}`;
const admin = createClient(keys.api, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });
const ids = [];
const chat = page => page.locator('dialog.assistant-workspace-panel');
const drawer = page => page.getByRole('complementary', { name: /^Bisedat me / }).or(page.getByRole('dialog', { name: /^Bisedat me / }));
async function login(page) {
  await page.goto('/login');
  await page.getByLabel('Email-i', { exact: true }).fill(tenant.email);
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(f.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103${base}`);
  await expect(chat(page).getByText('Po ngarkohet biseda…', { exact: true })).toHaveCount(0);
}
async function seed(title) {
  const id = randomUUID(); ids.push(id);
  for (const [op, revision, payload] of [['create', null, {}], ['rename', 0, { title }]]) {
    const r = await admin.rpc('write_migo_conversation', { p_business: tenant.id, p_user: tenant.userId, p_id: id, p_operation: op, p_revision: revision, p_payload: payload });
    expect(r.error).toBeNull();
  }
  return id;
}
test.beforeAll(() => verifyContainers());
test.beforeEach(async ({ context, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await context.routeWebSocket('**/*', r => new URL(r.url()).origin === 'ws://localhost:3103' ? r.connectToServer() : r.close());
  await context.route('**/*', r => ['http://localhost:3103', keys.api].includes(new URL(r.request().url()).origin) ? r.continue() : r.abort());
  await page.addInitScript(() => localStorage.setItem('agjenti-theme', 'dark'));
});
test.afterAll(async () => {
  for (const id of ids) {
    const r = await admin.from('migo_conversations').select('revision,deleted_at').eq('id', id).single();
    if (r.data && !r.data.deleted_at) {
      const deleted = await admin.rpc('write_migo_conversation', { p_business: tenant.id, p_user: tenant.userId, p_id: id, p_operation: 'delete', p_revision: r.data.revision });
      expect(deleted.error).toBeNull();
    }
  }
});
test('personalized primary navigation and grouped manual workspace preserve the same assistant', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Menuja e biznesit', exact: true });
  expect(await nav.getByRole('link').allTextContents()).toEqual(['Asistenti AI', 'Bisedat', 'Aktiviteti', 'Biznesi']);
  await chat(page).evaluate(el => { el.dataset.proof = 'one-instance'; });
  await page.locator('#business-assistant-input').fill('Draft i papërfunduar');
  await page.getByRole('button', { name: 'Personalizo asistentin', exact: true }).click();
  await page.getByLabel('Emri i asistentit', { exact: true }).fill('Aria');
  await page.getByRole('button', { name: 'Ruaj pamjen', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Aria', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Biznesi', exact: true }).click();
  const groups = page.getByRole('navigation', { name: 'Menaxhimi i biznesit', exact: true });
  await expect(groups.locator('details')).toHaveCount(5);
  await page.screenshot({ path: `${work}/navigation-after-business-desktop.png` });
  await groups.getByText('Çfarë ofron biznesi', { exact: true }).click();
  await expect(groups.getByRole('link', { name: /Produkte/ })).toBeVisible();
  await expect(groups.locator(`a[href="${base}/services"]`)).toHaveCount(0);
  await groups.getByText('Si sillet agjenti', { exact: true }).click();
  await expect(groups.getByRole('link', { name: /Agjenti i klientëve/ })).toBeVisible();
  await page.locator('.business-hub-utilities summary').click();
  await expect(page.getByRole('link', { name: /Workflow Designer · prova/ })).toBeVisible();
  await nav.getByRole('link', { name: 'Aria', exact: true }).click();
  await expect(page.locator('#business-assistant-input')).toHaveValue('Draft i papërfunduar');
  await expect(chat(page)).toHaveAttribute('data-proof', 'one-instance');
  await page.reload();
  await expect(nav.getByRole('link', { name: 'Aria', exact: true })).toBeVisible();
  await page.goto(`${base}/settings/migo`);
  await expect(page).toHaveURL(`http://localhost:3103${base}/settings/assistant`);
  await expect(page.getByLabel('Emri i asistentit', { exact: true })).toHaveValue('Aria');
});
test('desktop drawer supports keyboard menus, selected state, rename, cancel and confirmed deletion', async ({ page }) => {
  const title = `Plan sintetik ${randomUUID().slice(0, 6)}`, id = await seed(title);
  await login(page);
  const trigger = page.getByRole('button', { name: 'Historiku i asistentit', exact: true });
  await trigger.click();
  await expect(drawer(page)).toBeVisible();
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await expect(drawer(page).getByRole('button', { name: 'Mbyll historikun' })).toBeFocused();
  await expect(drawer(page).getByRole('navigation', { name: 'Bisedat private' })).toHaveAttribute('aria-busy', 'false');
  await expect(drawer(page).getByRole('button', { name: new RegExp(`^${title}`) })).toBeVisible();
  await page.screenshot({ path: `${work}/navigation-after-history-desktop.png` });
  await drawer(page).getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await trigger.click();
  await expect(drawer(page).getByRole('button', { name: new RegExp(`^${title}`) })).toHaveAttribute('aria-current', 'true');
  await drawer(page).getByRole('button', { name: `Veprime për ${title}` }).click();
  await expect(drawer(page).getByRole('menuitem', { name: 'Riemërto' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByRole('button', { name: `Veprime për ${title}` })).toBeFocused();
  await drawer(page).getByRole('button', { name: `Veprime për ${title}` }).click();
  await drawer(page).getByRole('menuitem', { name: 'Riemërto' }).click();
  await drawer(page).getByLabel('Titulli i bisedës').fill(`${title} ri`);
  await drawer(page).getByRole('button', { name: 'Ruaj', exact: true }).click();
  const renamed = `${title} ri`;
  await expect(drawer(page).getByRole('button', { name: `Veprime për ${renamed}` })).toBeVisible();
  expect((await admin.from('migo_conversations').select('title').eq('id', id).single()).data.title).toBe(renamed);
  await drawer(page).getByRole('button', { name: `Veprime për ${renamed}` }).click();
  await drawer(page).getByRole('menuitem', { name: 'Fshi' }).click();
  await drawer(page).getByRole('button', { name: 'Anulo' }).click();
  expect((await admin.from('migo_conversations').select('deleted_at').eq('id', id).single()).data.deleted_at).toBeNull();
  await drawer(page).getByRole('button', { name: `Veprime për ${renamed}` }).click();
  await drawer(page).getByRole('menuitem', { name: 'Fshi' }).click();
  await drawer(page).getByRole('button', { name: 'Fshi përgjithmonë' }).click();
  await expect(drawer(page).getByRole('button', { name: `Veprime për ${renamed}` })).toHaveCount(0);
  expect((await admin.from('migo_conversations').select('deleted_at').eq('id', id).single()).data.deleted_at).not.toBeNull();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); await chat(page).locator('.assistant-body').click({ position: { x: 500, y: 30 } });
  await expect(drawer(page)).toHaveCount(0);
});
test('mobile drawer has no stacked modal, traps focus, restores focus and fits 320px', async ({ page }) => {
  const title = `Plan sintetik për javën ${randomUUID().slice(0, 6)}`;
  await seed(title);
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  const trigger = page.getByRole('button', { name: 'Historiku i asistentit', exact: true });
  await trigger.click();
  await expect(drawer(page)).toHaveAttribute('aria-modal', 'true');
  const back = drawer(page).getByRole('button', { name: 'Mbyll historikun' });
  await expect(back).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await drawer(page).evaluate(el => el.contains(document.activeElement))).toBe(true);
  await expect(drawer(page).getByRole('navigation', { name: 'Bisedat private' })).toHaveAttribute('aria-busy', 'false');
  await expect(drawer(page).getByRole('button', { name: new RegExp(`^${title}`) })).toBeVisible();
  await back.focus();
  await drawer(page).getByRole('navigation', { name: 'Bisedat private' }).evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: `${work}/navigation-after-history-mobile.png` });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Hap ose mbyll menunë', exact: true }).click();
  await page.getByRole('navigation', { name: 'Menuja e biznesit', exact: true }).getByRole('link', { name: 'Biznesi', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103${base}/business`);
  await expect(page.getByRole('heading', { name: 'Biznesi', exact: true })).toBeVisible();
  await page.screenshot({ path: `${work}/navigation-after-business-mobile.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('history pagination comes from the server and opening a row never replays an action', async ({ page }) => {
  const prefix = `Faqe ${randomUUID().slice(0, 6)}`;
  for (let n = 0; n < 22; n++) await seed(`${prefix} ${n}`);
  await login(page); let actions = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/business-assistant?')) actions++; });
  await page.getByRole('button', { name: 'Historiku i asistentit', exact: true }).click();
  await expect(drawer(page).getByRole('button', { name: new RegExp(`^${prefix} 0 `) })).toHaveCount(0);
  await drawer(page).getByRole('button', { name: 'Më shumë biseda' }).click();
  const row = drawer(page).getByRole('button', { name: new RegExp(`^${prefix} 0 `) });
  await expect(row).toBeVisible(); await row.click();
  await expect(drawer(page)).toHaveCount(0); expect(actions).toBe(0);
});
