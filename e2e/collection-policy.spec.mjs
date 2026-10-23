// Real local Auth -> application action -> published runtime -> sealed state.
// No LLM/provider stubs. Booking extraction remains unverified offline.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { work, verifyContainers, localKeys, sql, project } from './local.mjs';
import { quote, json, graphFor } from './fixtures.mjs';
import { observeServerActions, readServerAction } from './flight.mjs';
const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const keys = localKeys(), origin = 'http://localhost:3103';
const tenant = kind => fixtures.tenants.find(t => t.kind === kind);
function decode(token) {
  const [, iv, tag, data] = token.split('.');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(fixtures.encryptionKey, 'hex'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString()).state;
}
async function login(page, t) {
  await page.goto('/login'); await page.getByLabel('Email-i', { exact: true }).fill(t.email);
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(fixtures.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/b/${t.slug}`);
  await page.goto(`/b/${t.slug}/agents/test`);
}
async function send(page, message) {
  const input = page.locator('#agent-test-message'); await input.fill(message);
  const { result: raw } = await readServerAction(page, () => input.press('Enter'));
  expect(raw.error).toBeUndefined(); const result = raw.turn ?? raw;
  await expect(page.getByText(result.reply, { exact: true }).last()).toBeVisible();
  const state = decode(raw.session);
  await test.info().attach('collection-turn', { body: Buffer.from(JSON.stringify({ message, reply: result.reply,
    preparedRequest: result.preparedRequest, state })), contentType: 'application/json' });
  return { ...result, state };
}
function configure(t, profileFields = []) {
  // Explicit test fixture administration, not runtime auto-activation/publication.
  const g = graphFor(t, 'DRAFT');
  const row = JSON.parse(sql(`select row_to_json(w) from public.visual_workflows w where business_id=${quote(t.id)};`));
  sql(`select public.save_visual_workflow(${quote(t.id)},${quote(t.userId)},${row.revision},${json(g)},'disable');`);
  const revision = Number(sql(`select coalesce((agent_collection_policy->>'revision')::int,0) from public.businesses where id=${quote(t.id)};`));
  const scopes = [{ versionId: row.published_version_id, flowId: t.kind, domain: t.kind === 'retail' ? 'order' : 'service', mode: 'collection_only', profileFields }];
  sql(`select public.save_agent_collection_policy(${quote(t.id)},${quote(t.userId)},${revision},${json(scopes)});`);
  sql(`select public.save_visual_workflow(${quote(t.id)},${quote(t.userId)},${row.revision + 1},${json(g)},'enable');`);
}
function verifyPersistence(t, review, confirmed) {
  // Actual browser-returned state through the channel CAS RPC. Not a live send.
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='10s';
    do $test$ declare c uuid:=gen_random_uuid(); channel_id uuid:=gen_random_uuid(); q public.workflow_inbound_queue;
      pending jsonb:=${json(review)}; confirmed jsonb:=${json(confirmed)};
    begin
      insert into public.instagram_connections(id,business_id,ig_user_id,access_token_ciphertext) values(channel_id,${quote(t.id)},channel_id::text,'synthetic-only');
      insert into public.conversations(id,business_id,instagram_participant_id,instagram_connection_id,auto_reply,status)
        values(c,${quote(t.id)},c::text,channel_id,true,'active');
      insert into public.conversation_states(conversation_id,business_id) values(c,${quote(t.id)});
      insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,conversation_id,status,lease_token,leased_until)
        values(${quote(t.id)},channel_id,c::text,c::text,'{}',c,'processing',gen_random_uuid(),now()+interval '2 minutes') returning * into q;
      perform public.prepare_workflow_reply(q.id,q.lease_token,c,0,pending,null,'Synthetic review',null,false);
      if (select collected from public.conversation_states where conversation_id=c) is distinct from pending then raise exception 'review_roundtrip_failed'; end if;
      update public.workflow_inbound_queue set status='ignored' where id=q.id;
      insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,conversation_id,status,lease_token,leased_until)
        values(${quote(t.id)},channel_id,c::text,c::text||'-2','{}',c,'processing',gen_random_uuid(),now()+interval '2 minutes') returning * into q;
      begin
        perform public.prepare_workflow_reply(q.id,q.lease_token,c,0,pending,null,'Stale',null,false);
        raise exception 'stale_collection_accepted' using errcode='XX001';
      exception when raise_exception then if sqlerrm<>'stale_state' then raise; end if; end;
      perform public.prepare_workflow_reply(q.id,q.lease_token,c,1,confirmed,null,'Synthetic confirmed request',null,false);
      if (select collected from public.conversation_states where conversation_id=c) is distinct from confirmed
        or (select revision from public.conversation_states where conversation_id=c)<>2 then raise exception 'confirmed_roundtrip_failed'; end if;
    end $test$; rollback;`);
}
test.beforeAll(() => {
  expect(project).toBe('agjenti-e2e-local-recovery-3a-20261023'); verifyContainers();
  configure(tenant('retail'), ['email']); configure(tenant('quote'));
});
test.beforeEach(async ({ page, context }) => {
  await observeServerActions(page);
  await context.route('**/*', r => [origin, keys.api].includes(new URL(r.request().url()).origin) ? r.continue() : r.abort());
  await context.routeWebSocket('**/*', r => new URL(r.url()).origin === 'ws://localhost:3103' ? r.connectToServer() : r.close());
});
test('digital request: configured fields -> email only -> reviewed; no shipping or automatic transaction', async ({ page }) => {
  const t = tenant('retail'); await login(page, t);
  expect((await send(page, 'Dua të porosis E2E Shirt')).reply).toBe('size A?');
  expect((await send(page, 'L')).reply).toBe('quantity A?');
  expect((await send(page, '2')).reply).toBe('Confirm A?');
  const fields = await send(page, 'po'); expect(fields.reply).toContain('emailin');
  expect(fields.reply).not.toMatch(/qytetin|adresën/);
  const review = await send(page, 'synthetic@example.test'); expect(review.state.step_key).toBe('order_confirm');
  expect(review.reply).toContain('Nuk krijohet porosi'); expect(review.reply).not.toContain('Sasia: 1');
  const done = await send(page, 'po'); expect(done.state.step_key).toBe('order_ready');
  expect(done.preparedRequest).toMatchObject({ domain: 'order', review: 'customer_confirmed', handoff: 'not_handed_off', transaction: 'not_executed_by_agent' });
  expect(done.state.visual.collection).toMatchObject({ businessId: t.id, mode: 'collection_only' });
  verifyPersistence(t, review.state, done.state);
});
test('physical request: profile requirements, interruption, correction and fresh review', async ({ page }) => {
  const t = tenant('retail');
  configure(t, ['name', 'phone', 'city', 'address']);
  try {
    await login(page, t);
    expect((await send(page, 'Dua të porosis E2E Shirt')).reply).toBe('size A?');
    expect((await send(page, 'M')).reply).toBe('quantity A?');
    const invalid = await send(page, 'many');
    expect(invalid.state.context.order.quantity).toBeUndefined();
    expect(invalid.state.visual.nodeId).toBe('quantity');
    const info = await send(page, 'What does this product include?');
    expect(info.state.processes.order.status).toBe('suspended');
    const resumed = await send(page, 'Vazhdo porosinë');
    expect(resumed.reply).toBe('quantity A?');
    expect(resumed.state.context.order.size.value).toBe('M');
    await send(page, '2');
    expect((await send(page, 'po')).reply).toContain('emrin');
    expect((await send(page, 'Ana Test')).reply).toContain('telefonin');
    expect((await send(page, '+355691234567')).reply).toContain('qytetin');
    expect((await send(page, 'Tirane')).reply).toContain('adresën');
    const review = await send(page, 'Rruga Sintetike 12');
    expect(review.state.step_key).toBe('order_confirm');
    const done = await send(page, 'po');
    expect(done.preparedRequest).toMatchObject({ review: 'customer_confirmed', transaction: 'not_executed_by_agent',
      collectedFields: { customer_city: 'Tirane', customer_address: 'Rruga Sintetike 12' } });
    const corrected = await send(page, 'telefoni: +355699876543');
    expect(corrected.state.context.profile.phone.value).toBe('+355699876543');
    expect(corrected.state.context.execution.orderConfirmed).toBe(false);
    expect(corrected.state.context.execution.orderReview.confirmed).toBe(false);
    expect(corrected.state.context.execution.orderReview.id).not.toBe(done.state.context.execution.orderReview.id);
    expect(corrected.state.context.order.quantity.value).toBe('2');
    verifyPersistence(t, review.state, corrected.state);
    // A missing projection is not evidence of a fresh corrected review.
    expect(corrected.preparedRequest).toBeDefined();
    expect(corrected.preparedRequest.review).not.toBe('customer_confirmed');
    expect(corrected.preparedRequest.collectedFields.customer_phone).toBe('+355699876543');
    expect(corrected.state.processes.order.id).toBe(done.state.processes.order.id);
    expect(corrected.state.visual.versionId).toBe(done.state.visual.versionId);
    expect(corrected.state.processes.order.status).toBe('active');
    expect(corrected.state.step_key).toBe('order_confirm');
    const duplicate = await send(page, 'telefoni: +355699876543');
    expect(duplicate.preparedRequest).toMatchObject({ review: 'review_requested', collectedFields: { customer_phone: '+355699876543' } });
    expect(duplicate.state.processes.order.id).toBe(done.state.processes.order.id);
    const reconfirmed = await send(page, 'po');
    expect(reconfirmed.preparedRequest).toMatchObject({ review: 'customer_confirmed', collectedFields: { customer_phone: '+355699876543' } });
    expect(reconfirmed.state.processes.order.id).toBe(done.state.processes.order.id);
    const phrase = await send(page, 'Telefoni im është +355699876543');
    expect(phrase.turnDecision.kind).toBe('correction');
    expect(phrase.preparedRequest).toMatchObject({ review: 'review_requested', collectedFields: { customer_phone: '+355699876543' } });
    expect((await send(page, 'po')).preparedRequest.review).toBe('customer_confirmed');
    const rejected = await send(page, 'telefoni: many');
    expect(rejected.preparedRequest).toBeDefined();
    expect(rejected.state.context.profile.phone.value).toBe('+355699876543');
    expect(rejected.turnDecision.kind).toBe('clarification');
    verifyPersistence(t, corrected.state, reconfirmed.state);
  } finally { configure(t, ['email']); }
});
test('service collection -> safe summary; no order/booking or false handoff', async ({ page }) => {
  const t = tenant('quote'); await login(page, t);
  expect((await send(page, 'Dua të vazhdoj me E2E Website')).reply).toBe('project_type A?');
  expect((await send(page, 'Landing page')).reply).toBe('budget A?');
  const invalid = await send(page, 'many');
  expect(invalid.state.processes.service.order.budget).toBeUndefined();
  expect(invalid.state.processes.service.visual.nodeId).toBe('budget');
  expect((await send(page, 'What are your hours?')).state.processes.service.status).toBe('suspended');
  expect((await send(page, 'vazhdo')).reply).toBe('budget A?');
  expect((await send(page, '1200')).reply).toBe('Confirm A?');
  const done = await send(page, 'po');
  expect(done.preparedRequest).toMatchObject({ domain: 'service', validation: 'valid', handoff: 'not_handed_off' });
  expect(done.state.processes.service.order).toHaveProperty('budget.value', '1200');
  expect(done.state.product_id).toBeNull();
  const correction = await send(page, 'budget: 1500');
  expect(correction.turnDecision.kind).toBe('clarification');
  expect(correction.preparedRequest).toMatchObject({ domain: 'service', collectedFields: { budget: '1200' } });
  expect(correction.state.processes.service.order.budget.value).toBe('1200');
});
test('real Auth/PostgREST denies direct policy writes, RPC spoofing and cross-tenant reads', async () => {
  const t = tenant('retail');
  const db = createClient(keys.api, keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  expect((await db.auth.signInWithPassword({ email: t.email, password: fixtures.password })).error).toBeNull();
  const before = sql(`select agent_collection_policy from public.businesses where id=${quote(t.id)};`);
  const update = await db.from('businesses').update({ agent_collection_policy: null }).eq('id', t.id).select('id');
  expect(update.error !== null || update.data?.length === 0).toBe(true);
  const rpc = await db.rpc('save_agent_collection_policy', { p_business: t.id, p_user: t.userId, p_revision: 1, p_scopes: [] });
  expect(rpc.error).not.toBeNull();
  const foreign = await db.from('businesses').select('id,agent_collection_policy').eq('id', tenant('quote').id);
  expect(foreign.data).toEqual([]);
  expect(sql(`select agent_collection_policy from public.businesses where id=${quote(t.id)};`)).toBe(before);
  await db.auth.signOut();
});
test.afterAll(() => {
  expect(sql('select (select count(*) from public.orders)+(select count(*) from public.order_items)+(select count(*) from public.order_submissions)+(select count(*) from public.bookings)+(select count(*) from public.customers)+(select count(*) from public.messages)+(select count(*) from public.workflow_inbound_queue)+(select count(*) from public.workflow_booking_effects);')).toBe('0');
});
