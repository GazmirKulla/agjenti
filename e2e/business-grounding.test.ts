/** Actual local PostgREST evidence through the production read adapter; no model. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { it, expect, vi } from 'vitest';
import { work, project, verifyContainers, localKeys, sql } from './local.mjs';
import { quote } from './fixtures.mjs';
import { readBusinessGrounding, projectBusinessGrounding } from '@/lib/agents/business-grounding';

it('R2 actual PostgREST distinguishes failed reads from empty/partial results and preserves scoped relevant provenance', async () => {
  expect(project).toBe('agjenti-e2e-local-recovery-3a-20261023'); verifyContainers();
  const keys = localKeys();
  const fixture = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
  const t = fixture.tenants.find((t: { kind: string }) => t.kind === 'information');
  const foreign = fixture.tenants.find((t: { kind: string }) => t.kind === 'retail');
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    if (new URL(input instanceof Request ? input.url : String(input)).origin !== keys.api) throw Error('EXTERNAL_NETWORK_FORBIDDEN');
    return original(input, init);
  });
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const before = sql('select (select count(*) from public.orders)+(select count(*) from public.bookings)+(select count(*) from public.customers)+(select count(*) from public.workflow_inbound_queue);');
  sql(`insert into public.knowledge_entries(id,business_id,title,body,is_active) values
    (${quote(ids[0])},${quote(t.id)},'R2 Refund','Synthetic refund within ten days',true),
    (${quote(ids[1])},${quote(t.id)},'R2 Refund','Synthetic refund within twenty days',true),
    (${quote(ids[2])},${quote(foreign.id)},'R2 Refund','Foreign business secret policy',true);`);
  try {
    const db = createClient(keys.api, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });
    const read = await readBusinessGrounding(db, t.id, ['knowledge', 'products', 'services']);
    expect(read.products).toMatchObject({ status: 'no_match', total: 0 });
    const context = projectBusinessGrounding(read, 'R2 Refund');
    expect(context.knowledge.records.map(k => k.id).sort()).toEqual(ids.slice(0, 2).sort());
    expect(JSON.stringify(context)).not.toContain('Foreign business secret');
    expect(context.knowledge).toMatchObject({ source: 'knowledge_entries', businessId: t.id, status: 'partial' });
    expect(projectBusinessGrounding(read, 'quantum astronomy physics').knowledge).toMatchObject({ status: 'no_match', records: [] });
    const failedDb = createClient(keys.api, keys.service, { db: { schema: 'r2_nonexistent_schema' }, auth: { persistSession: false, autoRefreshToken: false } });
    // Deliberately invalid schema to exercise a REAL rejected PostgREST read.
    const failed = await readBusinessGrounding(failedDb as unknown as SupabaseClient, t.id, ['knowledge', 'products', 'services']);
    for (const result of [failed.products, failed.services, failed.knowledge])
      expect(result).toMatchObject({ status: 'unavailable', reason: 'read_failed', total: null, records: [] });
    const off = await readBusinessGrounding(db, t.id, []);
    expect(off.knowledge).toMatchObject({ status: 'unavailable', reason: 'module_disabled', records: [] });
    const member = createClient(keys.api, keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await member.auth.signInWithPassword({ email: t.email, password: fixture.password })).error).toBeNull();
    const own = await readBusinessGrounding(member, t.id, ['knowledge']);
    expect(own.knowledge.records.map(k => k.id)).toContain(ids[0]);
    const other = await readBusinessGrounding(member, foreign.id, ['knowledge']);
    expect(other.knowledge.records).toEqual([]);
    await member.auth.signOut();
    expect(sql('select (select count(*) from public.orders)+(select count(*) from public.bookings)+(select count(*) from public.customers)+(select count(*) from public.workflow_inbound_queue);')).toBe(before);
  } finally {
    sql(`update public.knowledge_entries set is_active=false where id in (${ids.map(quote).join(',')});`);
    vi.unstubAllGlobals();
  }
});
