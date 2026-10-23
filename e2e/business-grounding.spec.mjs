// R2: actual local Auth/browser/API/PostgREST/SQL, no model or live channels.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID, createDecipheriv } from 'node:crypto';
import path from 'node:path';
import { work, project, verifyContainers, localKeys, sql } from './local.mjs';
import { quote } from './fixtures.mjs';
import { observeServerActions, readServerAction } from './flight.mjs';

const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const keys = localKeys(), origin = 'http://localhost:3103';
const retail = fixtures.tenants.find(t => t.kind === 'retail'), service = fixtures.tenants.find(t => t.kind === 'quote');
const beforeEffects = () => sql(`select json_build_array((select count(*) from public.orders),(select count(*) from public.order_submissions),
  (select count(*) from public.bookings),(select count(*) from public.customers),(select count(*) from public.workflow_inbound_queue),
  (select count(*) from public.workflow_booking_effects),(select count(*) from public.integrations),(select count(*) from public.messages));`);
const activeCount = () => Number(sql(`select count(*) from public.products where business_id=${quote(retail.id)} and is_active;`));
function decode(token) {
  const [, iv, tag, data] = token.split('.');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(fixtures.encryptionKey, 'hex'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString()).state;
}
async function login(page, tenant) {
  await page.goto('/login'); await page.getByLabel('Email-i', { exact: true }).fill(tenant.email);
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(fixtures.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/b/${tenant.slug}`);
  await page.goto(`/b/${tenant.slug}/agents/test`);
}
async function send(page, message) {
  const input = page.locator('#agent-test-message'); await input.fill(message);
  const { result } = await readServerAction(page, () => input.press('Enter'));
  expect(result.error).toBeUndefined();
  const turn = result.turn ?? result;
  await expect(page.getByText(turn.reply, { exact: true }).last()).toBeVisible();
  expect(turn.debug.source).not.toBe('ai');
  return { ...turn, state: decode(result.session) };
}
test.beforeAll(() => { expect(project).toBe('agjenti-e2e-local-recovery-3a-20261023'); verifyContainers(); });
test.beforeEach(async ({ page, context }) => {
  await observeServerActions(page);
  await context.route('**/*', r => [origin, keys.api].includes(new URL(r.request().url()).origin) ? r.continue() : r.abort());
  await context.routeWebSocket('**/*', r => new URL(r.url()).origin === 'ws://localhost:3103' ? r.connectToServer() : r.close());
});

test('R2 authoritative product count, changed prices, missing values, partial catalog and cross-tenant RLS', async ({ page }) => {
  test.setTimeout(120000);
  const before = beforeEffects(), run = randomUUID(), p = randomUUID(), inactive = randomUUID();
  const name = `R2 Package ${run}`;
  sql(`insert into public.products(id,business_id,name,sku,price_amount,currency,is_active)
    values(${quote(p)},${quote(retail.id)},${quote(name)},${quote(run)},123.45,'EUR',true),
    (${quote(inactive)},${quote(service.id)},'Foreign R2 private product',${quote(run)},999,'EUR',false);`);
  try {
    await login(page, retail);
    let result = await send(page, 'Sa produkte keni?');
    expect(result.reply).toContain(`${activeCount()} produkte aktive`);
    result = await send(page, `Sa kushton ${name}?`);
    expect(result.reply).toContain('123.45 EUR'); expect(result.state.product_id).toBeNull();
    // All current fixture prices must be comparable; never infer extrema from a subset.
    expect(sql(`select count(*) from public.products where business_id=${quote(retail.id)} and is_active and (price_amount is null or currency<>'EUR');`)).toBe('0');
    const minPrice = sql(`select min(price_amount) from public.products where business_id=${quote(retail.id)} and is_active;`);
    const maxPrice = sql(`select max(price_amount) from public.products where business_id=${quote(retail.id)} and is_active;`);
    expect((await send(page, 'Cili është produkti më i lirë?')).reply).toContain(`${Number(minPrice)} EUR`);
    expect((await send(page, 'Cili është produkti më i shtrenjtë?')).reply).toContain(`${Number(maxPrice)} EUR`);
    sql(`update public.products set price_amount=145 where id=${quote(p)};`);
    result = await send(page, `Sa kushton ${name}?`);
    expect(result.reply).toContain('145 EUR'); expect(result.reply).not.toContain('123.45');
    sql(`update public.products set price_amount=null where id=${quote(p)};`);
    result = await send(page, `Sa kushton ${name}?`);
    expect(result.reply).toContain('nuk është i përcaktuar');
    sql(`update public.products set is_active=false where id=${quote(p)};`);
    result = await send(page, 'Sa produkte keni?'); expect(result.reply).toContain(`${activeCount()} produkte aktive`);
    sql(`insert into public.products(business_id,name,sku,description,price_amount,currency,is_active)
      select ${quote(retail.id)},'R2 Synthetic item '||g,${quote(run)}||'-'||g,${quote(run)},g,'EUR',true from generate_series(1,1005) g;`);
    result = await send(page, 'Sa produkte keni?');
    expect(activeCount()).toBeGreaterThan(1000); expect(result.reply).toContain(`${activeCount()} produkte aktive`);
    result = await send(page, 'Cili është produkti më i lirë?');
    expect(result.reply).toContain('vetëm një pjesë'); // No invented global minimum from a subset.
    const client = createClient(keys.api, keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = await client.auth.signInWithPassword({ email: retail.email, password: fixtures.password }); expect(auth.error).toBeNull();
    const visible = await client.from('products').select('id', { count: 'exact' }).eq('business_id', retail.id).eq('is_active', true).limit(3);
    expect(visible.error).toBeNull(); expect(visible.count).toBe(activeCount()); expect(visible.data).toHaveLength(3);
    const foreign = await client.from('products').select('id').eq('business_id', service.id).eq('id', inactive);
    expect(foreign.error).toBeNull(); expect(foreign.data).toEqual([]);
    await client.auth.signOut();
    expect(beforeEffects()).toBe(before);
    await test.info().attach('r2-read-evidence', { body: Buffer.from(JSON.stringify({ count: activeCount(), returnedPage: 3,
      changedPrice: true, missingPrice: true, inactiveExcluded: true, crossTenantRlsDenied: true, businessEffectsUnchanged: true, realModelCalled: false })), contentType: 'application/json' });
  } finally {
    sql(`update public.products set is_active=false where (sku=${quote(run)} or description=${quote(run)}) and business_id in (${quote(retail.id)},${quote(service.id)});`);
  }
});

test('R2 exact service facts do not imply bookings; module OFF does not leak them', async ({ page }) => {
  test.setTimeout(90000);
  const before = beforeEffects(), id = randomUUID(), name = `R2 Advisory ${id}`;
  const profile = sql(`select dashboard_profile from public.businesses where id=${quote(service.id)};`);
  sql(`insert into public.booking_services(id,business_id,name,description,price_amount,currency,price_mode,duration_minutes,booking_enabled,is_active)
    values(${quote(id)},${quote(service.id)},${quote(name)},'Synthetic information only',40,'EUR','from',45,false,true);`);
  try {
    await login(page, service);
    const price = await send(page, `Sa kushton ${name}?`);
    expect(price.reply).toContain('nga 40 EUR');
    const duration = await send(page, `Sa zgjat ${name}?`);
    expect(duration.reply).toContain('45 min'); expect(duration.reply).toContain('nuk konfirmon termine');
    expect(duration.state.fields.booking).toBeUndefined(); expect(duration.state.processes?.booking).toBeUndefined();
    sql(`update public.businesses set dashboard_profile=jsonb_set(dashboard_profile,'{enabledModules}',(dashboard_profile->'enabledModules')-'services') where id=${quote(service.id)};`);
    const blocked = await send(page, `Sa kushton ${name}?`);
    expect(blocked.reply).not.toContain('40 EUR');
    expect(beforeEffects()).toBe(before);
  } finally {
    sql(`update public.businesses set dashboard_profile=${quote(profile)}::jsonb where id=${quote(service.id)};
      update public.booking_services set is_active=false where business_id=${quote(service.id)} and id=${quote(id)};`);
  }
});

test('R2 product price interruption keeps service ownership and pinned cursor', async ({ page }) => {
  test.setTimeout(90000);
  const before = beforeEffects();
  await login(page, service);
  const name = sql(`select name from public.booking_services where id=${quote(service.entityId)};`);
  const process = await send(page, `Dua të vazhdoj me ${name}`);
  expect(process.state.processes.service).toBeDefined();
  const saved = structuredClone(process.state.processes.service);
  const info = await send(page, 'Sa produkte keni?');
  expect(info.reply).toContain('çaktivizuar');
  expect(info.state.processes.service.versionId).toBe(saved.versionId);
  expect(info.state.processes.service.visual.nodeId).toBe(saved.visual.nodeId);
  const resumed = await send(page, 'Vazhdo');
  expect(resumed.state.processes.service.versionId).toBe(saved.versionId);
  expect(resumed.state.processes.service.visual.nodeId).toBe(saved.visual.nodeId);
  expect(beforeEffects()).toBe(before);
});
