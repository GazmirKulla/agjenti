import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { work, verifyContainers, localKeys } from './local.mjs';

// Real isolated Auth/dashboard. No provider requests or business mutations.
const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const tenant = fixtures.tenants.find(item => item.kind === 'retail');
const keys = localKeys();
const widget = page => page.getByRole('region', { name: 'Asistenti yt personal' });

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

for (const width of [1360, 390, 320]) {
  test(`simple header assistant at ${width}px clears old preferences and opens the existing conversation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.evaluate(() => {
      localStorage.setItem('agjenti:personal-assistant:v1:old-user:old-shop', JSON.stringify({ name: 'Luna', avatar: 'mint' }));
      localStorage.setItem('agjenti-theme', 'dark');
    });
    await page.reload();
    await expect(widget(page)).toHaveText('Asistenti AI');
    await expect(widget(page).getByRole('button')).toHaveCount(1);
    await expect(widget(page).locator('svg.assistant-robot')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Personalizo asistentin' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('agjenti:personal-assistant:v1:old-user:old-shop'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('agjenti-theme'))).toBe('dark');
    await expect(widget(page)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: path.join(work, `assistant-simple-${width}.png`) });
    await widget(page).getByRole('button', { name: 'Hap bisedën me Asistenti AI' }).click();
    await expect(page.locator('#business-assistant-input')).toBeVisible();
    await page.goto(`/b/${tenant.slug}/settings/assistant`);
    await expect(page).toHaveURL(`http://localhost:3103/b/${tenant.slug}/settings/profile`);
    await expect(page.getByRole('heading', { name: 'Asistenti yt, në stilin tënd.' })).toHaveCount(0);
  });
}
