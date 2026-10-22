import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { work, verifyContainers, localKeys, sql } from './local.mjs';
import { quote } from './fixtures.mjs';

// Real local Auth/PostgREST. Apply the S1 migration to the disposable stack first.
// No hosted URLs, provider credentials, grants or RLS bypasses in these tests.
let owner, service, a, b, own, foreign, conversation;
test.beforeAll(() => verifyContainers());
test.beforeEach(async () => {
  const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
  [a, b] = fixtures.tenants;
  const keys = localKeys();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  owner = createClient(keys.api, keys.anon, options);
  service = createClient(keys.api, keys.service, options);
  expect((await owner.auth.signInWithPassword({ email: a.email, password: fixtures.password })).error).toBeNull();
  own = randomUUID(); foreign = randomUUID(); conversation = randomUUID();
  expect((await service.from('customers').insert([
    { id: own, business_id: a.id, display_name: 'S1 own' },
    { id: foreign, business_id: b.id, display_name: 'S1 foreign' },
  ])).error).toBeNull();
  expect((await owner.from('conversations').insert({ id: conversation, business_id: a.id, auto_reply: false })).error).toBeNull();
});
test.afterEach(() => {
  // Only this test's UUIDs; preserve all pre-existing synthetic fixtures.
  sql(`begin; delete from public.conversations where id=${quote(conversation)};
    delete from public.customers where id in (${quote(own)},${quote(foreign)}); commit;`);
});

test('S1 owner cannot associate an owned conversation with a foreign customer', async () => {
  expect((await owner.from('customers').select('id').eq('id', foreign)).data).toEqual([]);
  const result = await owner.from('conversations').update({ customer_id: foreign }).eq('id', conversation);
  expect(result.error?.code).toBe('23503');
  expect((await service.from('conversations').select('customer_id').eq('id', conversation).single()).data.customer_id).toBeNull();
});

test('S1 owner cross-tenant INSERT and UPSERT fail atomically', async () => {
  const inserted = await owner.from('conversations').insert({ business_id: a.id, customer_id: foreign });
  expect(inserted.error?.code).toBe('23503');
  const upserted = await owner.from('conversations').upsert({ id: conversation, business_id: a.id, customer_id: foreign });
  expect(upserted.error?.code).toBe('23503');
  expect((await owner.from('conversations').select('customer_id').eq('id', conversation).single()).data.customer_id).toBeNull();
});

test('S1 same-tenant association, PostgREST embeds, NULL and delete cascade remain valid', async () => {
  expect((await owner.from('conversations').update({ customer_id: own }).eq('id', conversation)).error).toBeNull();
  for (const client of [owner, service]) {
    const joined = await client.from('conversations').select('id,customers(business_id,display_name)').eq('id', conversation).single();
    expect(joined.error).toBeNull();
    expect(joined.data.customers).toEqual({ business_id: a.id, display_name: 'S1 own' });
    const hinted = await client.from('conversations').select('customers!conversations_customer_id_fkey(id)').eq('id', conversation).single();
    expect(hinted.error).toBeNull(); expect(hinted.data.customers.id).toBe(own);
  }
  expect((await owner.from('conversations').update({ customer_id: null }).eq('id', conversation)).error).toBeNull();
  expect((await owner.from('conversations').update({ customer_id: own }).eq('id', conversation)).error).toBeNull();
  expect((await owner.from('customers').delete().eq('id', own)).error).toBeNull();
  expect((await owner.from('conversations').select('id').eq('id', conversation)).data).toEqual([]);
});

test('S1 service role cannot forge the link or move either side to another tenant', async () => {
  expect((await service.from('conversations').update({ customer_id: foreign }).eq('id', conversation)).error?.code).toBe('23503');
  expect((await service.from('conversations').update({ customer_id: own }).eq('id', conversation)).error).toBeNull();
  expect((await service.from('conversations').update({ business_id: b.id }).eq('id', conversation)).error?.code).toBe('23503');
  expect((await service.from('customers').update({ business_id: b.id }).eq('id', own)).error?.code).toBe('23503');
});

test('S1 RLS and privileged order RPC authorization remain closed', async () => {
  const forbidden = await owner.from('conversations').insert({ business_id: b.id, customer_id: foreign });
  expect(forbidden.error?.code).toBe('42501');
  const args = { p_business: b.id, p_user: a.userId, p_conversation: conversation,
    p_revision: 0, p_collected: {}, p_order: {}, p_enforce_modules: false };
  expect((await owner.rpc('submit_confirmed_order', args)).error?.code).toBe('42501');
  expect((await service.rpc('submit_confirmed_order', args)).error?.message).toBe('unauthorized');
});

test('S1 concurrent valid and foreign owner writes never persist a cross-tenant link', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    owner.from('conversations').update({ customer_id: i % 2 ? foreign : own }).eq('id', conversation)));
  results.forEach((result, i) => {
    if (i % 2) expect(result.error?.code).toBe('23503'); else expect(result.error).toBeNull();
  });
  expect((await service.from('conversations').select('business_id,customer_id').eq('id', conversation).single()).data)
    .toEqual({ business_id: a.id, customer_id: own });
});
