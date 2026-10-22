import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { work, verifyContainers, localKeys } from './local.mjs';

// Real isolated Auth/dashboard and navigation. Assistant replies are synthetic UI
// fixtures: no provider call, activation, workflow publication or business write.
const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const retail = fixtures.tenants.find(item => item.kind === 'retail');
const appointment = fixtures.tenants.find(item => item.kind === 'appointment');
const keys = localKeys();
const chat = page => page.locator('dialog.assistant-workspace-panel');
const input = page => page.locator('#business-assistant-input');
const widget = page => page.getByRole('region', { name: 'Asistenti yt personal' });
async function login(page, tenant = retail) {
  await page.goto('/login');
  await page.getByLabel('Email-i', { exact: true }).fill(tenant.email);
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(fixtures.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  await expect(page).toHaveURL(tenant.slug ? `http://localhost:3103/b/${tenant.slug}` : 'http://localhost:3103/admin');
  if (tenant.slug) await expect(input(page)).toBeVisible();
}
async function send(page, text) {
  await input(page).fill(text);
  await chat(page).getByRole('button', { name: 'Dërgo mesazhin', exact: true }).click();
}
async function navigate(page, path) {
  // Products moved out of the primary sidebar; search is still a direct route
  // transition, preserving the original Back/Forward and mount assertions.
  if (path === 'products') {
    await page.getByRole('textbox', { name: 'Kërko faqe', exact: true }).fill('Produkte');
    await page.locator(`.search-results a[href="/b/${retail.slug}/products"]`).first().click();
  } else if (path === 'agents') {
    await page.locator(`.dashboard-sidebar a[href="/b/${retail.slug}/business"]`).click();
    const groups = page.getByRole('navigation', { name: 'Menaxhimi i biznesit', exact: true });
    await groups.getByText('Si sillet agjenti', { exact: true }).click();
    await groups.getByRole('link', { name: /Agjenti i klientëve/ }).click();
  } else {
    await page.locator(`.dashboard-sidebar a[href="/b/${retail.slug}${path ? `/${path}` : ''}"]`).first().click();
  }
  await expect(page).toHaveURL(`http://localhost:3103/b/${retail.slug}${path ? `/${path}` : ''}`);
}
test.beforeAll(() => verifyContainers());
test.beforeEach(async ({ context }) => {
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === 'ws://localhost:3103' ? route.connectToServer() : route.close());
  await context.route('**/*', route => ['http://localhost:3103', keys.api].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort('blockedbyclient'));
});

test('desktop: one mounted conversation, personal identity, manual overview and compact page entry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await expect(chat(page)).toHaveCount(1);
  await expect(page.locator('#assistant-home-input, #assistant-context-input, #assistant-dock-input')).toHaveCount(0);
  await expect(chat(page)).toContainText('Asistenti AI — Asistenti yt');
  await expect(chat(page).getByRole('button', { name: 'Përgatit ofertën time' })).toBeVisible();
  await expect(widget(page).locator('.personal-assistant-avatar')).toHaveCSS('animation-name', 'none');
  await expect(page.getByRole('navigation', { name: 'Menuja e biznesit', exact: true }).getByRole('link', { name: 'Biznesi', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(work, 'ux1-after-desktop.png') });
  await page.getByText('Pasqyra e biznesit dhe veprimet manuale', { exact: true }).click();
  await expect(page.locator('.assistant-first-home')).toHaveAttribute('open', '');
  await input(page).fill('Draft personal që nuk duhet të humbasë');
  await chat(page).evaluate(element => { element.dataset.mountProof = 'same-conversation'; });
  await navigate(page, 'products');
  await expect(page.locator('.assistant-context-entry textarea')).toHaveCount(0);
  const entry = page.getByRole('button', { name: 'Pyet Asistenti AI për produktet', exact: true });
  await entry.focus(); await page.keyboard.press('Enter');
  await expect(input(page)).toHaveValue('Draft personal që nuk duhet të humbasë');
  await expect(input(page)).toBeFocused();
  await expect(chat(page)).toHaveAttribute('data-mount-proof', 'same-conversation');
  await page.keyboard.press('Escape');
  await expect(chat(page)).not.toBeVisible();
  await expect(entry).toBeFocused();
  await page.goBack();
  await expect(input(page)).toBeVisible();
  await expect(input(page)).toHaveValue('Draft personal që nuk duhet të humbasë');
  await expect(chat(page)).toHaveAttribute('data-mount-proof', 'same-conversation');
});

test('actual request context: history boundary and selected product are shown truthfully', async ({ page }) => {
  const requests = [];
  await page.route('**/api/business-assistant?*', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { message: `Përgjigje sintetike ${requests.length}` } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await send(page, 'Kërkesë nga Home');
  await expect(chat(page)).toContainText('Përgjigje sintetike 1');
  await navigate(page, 'products');
  await page.getByRole('checkbox', { name: 'Zgjidh E2E Shirt', exact: true }).check();
  await page.getByRole('button', { name: 'Pyet Asistenti AI për këtë produkt', exact: true }).click();
  await expect(chat(page).getByRole('status', { name: 'Konteksti i kërkesës' })).toContainText('E2E Shirt');
  await expect(chat(page)).toContainText('historikun e autorizuar të kësaj bisede');
  await expect(chat(page)).toContainText('Përgjigje sintetike 1');
  await page.screenshot({ path: path.join(work, 'ux1-product-context.png') });
  await send(page, 'Pyetje për këtë produkt');
  await expect(chat(page)).toContainText('Përgjigje sintetike 2');
  expect(requests[1].context).toMatchObject({ page: 'products', entityId: retail.entityId, entityType: 'product', selectedEntityIds: [retail.entityId] });
  expect(requests[1].context).not.toHaveProperty('selectionLabel');
  expect(requests[1].history).toEqual([]);
  await expect(chat(page)).not.toContainText('Faqja ose zgjedhja ndryshoi.');
  await send(page, 'Vazhdo për të njëjtin produkt');
  await expect(chat(page)).toContainText('Përgjigje sintetike 3');
  expect(requests[2].history).toContainEqual({ role: 'assistant', content: 'Përgjigje sintetike 2' });
  expect(requests.every(request => request.assistantName === 'Asistenti AI')).toBe(true);
});

test('approval decisions survive navigation without execution or remounting', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/business-assistant?*', route => {
    calls++;
    return route.fulfill({ json: { message: 'Plan sintetik, jo ekzekutim.', actionPlan: {
      id: 'ux1-plan', request: 'Informo klientët', questions: [], assumptions: [], steps: [{
        id: 'knowledge', title: 'Përgjigje për klientët', description: 'Përdor njohuritë aktive.',
        requestedBehavior: 'Informo klientët', requiredCapability: 'knowledge.answer', capabilityReadiness: 'ready',
        readiness: 'READY', missingConfiguration: [], requiredDecision: null, proposedAction: 'Përfshije në plan.',
        approvalRequired: true, supported: true, reasonCode: 'verified_handler_and_configuration',
      }],
    } } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page); await send(page, 'Përgatit planin');
  await chat(page).getByRole('button', { name: 'Përfshi në plan', exact: true }).click();
  await expect(chat(page)).toContainText('Përfshirë vetëm në plan');
  await navigate(page, 'products');
  await page.getByRole('button', { name: 'Pyet Asistenti AI për produktet', exact: true }).click();
  await expect(chat(page)).toContainText('Përfshirë vetëm në plan');
  await expect(chat(page)).toContainText('Propozimi i hapur i përket:');
  await expect(chat(page)).toContainText('Asgjë e publikuar');
  await navigate(page, '');
  await expect(chat(page)).toContainText('Përfshirë vetëm në plan');
  expect(calls).toBe(1);
});

test('mobile: compact entry, working focus, manual access and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.screenshot({ path: path.join(work, 'ux1-after-mobile.png') });
  await expect(page.locator('.assistant-mobile-dock')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: 'Hap ose mbyll menunë' }).click();
  await page.getByRole('dialog', { name: 'Menuja kryesore' }).getByRole('link', { name: 'Biznesi', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3103/b/${retail.slug}/business`);
  await page.getByText('Çfarë ofron biznesi', { exact: true }).click();
  await page.getByRole('link', { name: /Produkte/ }).first().click();
  await page.getByRole('button', { name: 'Pyet Asistenti AI për produktet', exact: true }).click();
  await expect(input(page)).toBeFocused();
  await expect(chat(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chat(page)).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Pyet Asistenti AI për produktet', exact: true })).toBeFocused();
  await page.evaluate(() => localStorage.setItem('agjenti-theme', 'dark'));
  await page.reload();
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.locator('html')).toHaveAttribute('data-resolved', 'dark');
  await page.screenshot({ path: path.join(work, 'ux1-after-mobile-dark.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('service editor and selected service remain intact when opening Asistenti AI', async ({ page }) => {
  const requests = [];
  await page.route('**/api/business-assistant?*', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { message: 'Konteksti sintetik u pranua.' } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, appointment);
  await page.goto(`/b/${appointment.slug}/services`);
  await page.getByRole('button', { name: 'Ndrysho', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Emri', exact: true }).fill('Draft i paruajtur i shërbimit');
  await page.getByRole('button', { name: 'Ndrysho këtë shërbim me Asistenti AI', exact: true }).click();
  await expect(chat(page).getByRole('status', { name: 'Konteksti i kërkesës' })).toContainText('E2E Consultation');
  await send(page, 'Pyetje për shërbimin');
  await expect(chat(page)).toContainText('Konteksti sintetik u pranua.');
  expect(requests[0].context).toMatchObject({ page: 'services', entityType: 'service', entityId: appointment.entityId });
  await page.getByRole('button', { name: 'Mbyll bisedën', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ruaj shërbimin', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Emri', exact: true })).toHaveValue('Draft i paruajtur i shërbimit');
});

test('Advanced retains the workflow editor, dirty draft and request selection', async ({ page }) => {
  const requests = [];
  await page.route('**/api/business-assistant?*', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { message: 'Sqarim sintetik për nyjën.', clarifying: true } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await navigate(page, 'agents');
  await expect(page.getByRole('heading', { name: 'Agjenti i klientëve', exact: true })).toBeVisible();
  await page.getByText('Avancuar', { exact: true }).click();
  await page.getByRole('link', { name: 'Workflow Designer', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Editor i rrjedhës' })).toBeVisible();
  await page.getByRole('button', { name: 'Të gjithë hapat', exact: true }).click();
  // The synthetic graph has coincident coordinates. Exercise real keyboard selection.
  await page.getByRole('button', { name: /^size ·/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Emri i rrjedhës', { exact: true }).fill('UX1 unsaved draft');
  await page.getByRole('button', { name: 'Ndihmë me këtë rrjedhë · Asistenti AI', exact: true }).click();
  await expect(chat(page)).toContainText('Ka ndryshime të paruajtura në editor');
  await send(page, 'Pyetje, pa ruajtur draftin');
  await expect(chat(page)).toContainText('Sqarim sintetik për nyjën.');
  expect(requests[0].context.workflowSelection.dirty).toBe(true);
  expect(requests[0].context.workflowSelection.nodeId).toBe('size');
  expect(requests[0].context.workflowSelection.flowId).toBe('retail');
  expect(Number.isInteger(requests[0].context.workflowSelection.revision)).toBe(true);
  await page.getByRole('button', { name: 'Mbyll bisedën', exact: true }).click();
  await expect(page.getByLabel('Emri i rrjedhës', { exact: true })).toHaveValue('UX1 unsaved draft');
  await expect(page.getByRole('button', { name: 'Ruaj draft', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^quantity ·/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Ndihmë me këtë rrjedhë · Asistenti AI', exact: true }).click();
  await expect(chat(page)).toContainText('mbetet te rrjedha/nyja fillestare');
  await send(page, 'Përgjigje për kërkesën fillestare');
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].context.workflowSelection).toEqual(requests[0].context.workflowSelection);
});

test('knowledge context follows the displayed record and clears when creating a new one', async ({ page }) => {
  const requests = [];
  await page.route('**/api/business-assistant?*', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { message: 'Njohuria sintetike u identifikua.' } });
  });
  await login(page); await page.goto(`/b/${retail.slug}/knowledge`);
  await page.getByRole('button', { name: 'Përditëso njohuritë me Asistenti AI', exact: true }).click();
  await expect(chat(page).getByRole('status', { name: 'Konteksti i kërkesës' })).toContainText('E2E hours');
  await send(page, 'Pyetje për njohurinë e zgjedhur');
  await expect(chat(page)).toContainText('Njohuria sintetike u identifikua.');
  expect(requests[0].context).toMatchObject({ page: 'knowledge', entityType: 'knowledge' });
  expect(requests[0].context.entityId).toMatch(/^[a-f0-9-]{36}$/);
  await page.getByRole('button', { name: 'Mbyll bisedën', exact: true }).click();
  await page.getByRole('button', { name: '+ Shto njohuri', exact: true }).click();
  await page.getByRole('button', { name: 'Përditëso njohuritë me Asistenti AI', exact: true }).click();
  await expect(chat(page).getByRole('status', { name: 'Konteksti i kërkesës' })).not.toContainText('E2E hours');
  await send(page, 'Përgatit një njohuri të re');
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].context.entityId).toBeUndefined();
});

test('name persists after reload, is sent to the existing API and is isolated with history by user/business', async ({ page, context }) => {
  const requests = [];
  await page.route('**/api/business-assistant?*', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { message: 'Histori private sintetike për retail.' } });
  });
  await login(page);
  await widget(page).getByRole('button', { name: 'Personalizo asistentin' }).click();
  const settings = page.getByRole('dialog', { name: 'Asistenti yt, në stilin tënd.' });
  await settings.getByLabel('Emri i asistentit').fill('Luna');
  await settings.getByRole('button', { name: 'Ruaj pamjen', exact: true }).click();
  await page.reload();
  await expect(widget(page)).toContainText('Luna');
  await expect(chat(page)).toContainText('Luna — Asistenti yt');
  await send(page, 'Bisedë vetëm për retail');
  await expect(chat(page)).toContainText('Histori private sintetike për retail.');
  expect(requests[0].assistantName).toBe('Luna');
  await page.goto(`/b/${appointment.slug}`);
  await expect(page).toHaveURL(`http://localhost:3103/b/${retail.slug}`); // no membership: existing server guard
  await context.clearCookies(); // switch authenticated synthetic owners; keep localStorage
  await login(page, appointment);
  await expect(widget(page)).toContainText('Asistenti AI');
  await expect(chat(page).getByRole('status', { name: 'Konteksti i kërkesës' })).toContainText(appointment.name);
  await expect(chat(page)).not.toContainText('Histori private sintetike për retail.');
  await chat(page).getByRole('button', { name: 'Historiku i asistentit' }).click();
  await expect(page.getByRole('complementary', { name: 'Bisedat me Asistenti AI', exact: true })).not.toContainText('Bisedë vetëm për retail');
});

test('same authorized user switches tenants on desktop and mobile without carrying drafts or conversation state', async ({ page }) => {
  // Existing synthetic lab admin already has access to these tenants. No membership writes.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, fixtures.labUser);
  await page.goto(`/b/${retail.slug}`);
  await input(page).fill('Draft vetëm për retail');
  await page.locator('.workspace-picker > summary').click();
  await page.locator(`.workspace-options a[href="/b/${appointment.slug}"]`).click();
  await expect(page).toHaveURL(`http://localhost:3103/b/${appointment.slug}`);
  await expect(input(page)).toHaveValue('');
  await expect(chat(page).getByRole('status', { name: 'Konteksti i kërkesës' })).toContainText(appointment.name);
  await input(page).fill('Draft vetëm për appointment');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('combobox', { name: 'Biznesi aktiv' }).selectOption(retail.slug);
  await expect(page).toHaveURL(`http://localhost:3103/b/${retail.slug}`);
  await expect(input(page)).toHaveValue('');
  await expect(chat(page).getByRole('status', { name: 'Konteksti i kërkesës' })).toContainText(retail.name);
});

test('capability configuration stays above the same Home conversation through mobile resize and cancel', async ({ page }) => {
  const modes = [];
  await page.route('**/api/business-assistant?*', route => route.fulfill({ json: {
    message: 'Plan sintetik për kontrollin e dialogut.', actionPlan: {
      id: 'ux1-configuration', request: 'Njohuritë', questions: [], assumptions: [], steps: [{
        id: 'knowledge', title: 'Njohuritë', description: 'Kontrollo konfigurimin.', requestedBehavior: 'Informo klientët',
        requiredCapability: 'knowledge.answer', capabilityReadiness: 'missing_configuration', readiness: 'NEEDS_CONFIGURATION',
        missingConfiguration: ['Kontrollo njohuritë'], requiredDecision: null, proposedAction: 'Shqyrto konfigurimin.',
        approvalRequired: true, supported: true, reasonCode: 'synthetic_ui_fixture',
      }],
    },
  } }));
  // Real authorized inspection only. Explicitly prohibit any mutation from this test.
  await page.route('**/api/business-assistant/capability-activation?*', route => {
    const body = route.request().postDataJSON(); modes.push(body.mode);
    expect(body.mode).toBe('inspect');
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page); await send(page, 'Kontrollo njohuritë');
  await page.getByRole('button', { name: 'Konfiguro', exact: true }).click();
  const configuration = page.getByRole('region', { name: 'Aktivizo njohurinë për përgjigje', exact: true });
  await expect(configuration).toBeVisible();
  await expect(configuration.getByText('Po kontrollojmë konfigurimin…')).not.toBeVisible();
  await expect(configuration.getByRole('alert')).toHaveCount(0);
  // React StrictMode may start and abort the first read-only mount effect in dev.
  const inspectionsBeforeResize = modes.length;
  expect(inspectionsBeforeResize).toBeGreaterThan(0);
  expect(modes.every(mode => mode === 'inspect')).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(configuration).toBeVisible();
  await expect(page.locator('dialog:modal')).toHaveCount(0); // Inline Home configuration needs no nested modal.
  await page.keyboard.press('Escape');
  await expect(configuration).toHaveCount(0);
  await expect(chat(page)).toBeVisible();
  await expect(chat(page).getByRole('region', { name: 'Plani i veprimeve' })).toBeVisible();
  expect(modes).toHaveLength(inspectionsBeforeResize); // no remount/reinspection on resize or cancel
});
