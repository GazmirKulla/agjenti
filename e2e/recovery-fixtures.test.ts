/** Real local DB and production proposal validation. Intent is explicitly synthetic:
 * no LLM plan is claimed. The sealed proposals are consumed by authenticated HTTP tests. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { work, project, verifyContainers, localKeys, sql } from './local.mjs';
import { quote } from './fixtures.mjs';
import { prepareProposal } from '@/lib/business-assistant/service';

it('prepares tenant-bound C1 tickets from actual local rows without changing instructions', async () => {
  expect(project).toMatch(/^agjenti-e2e-local-recovery-[a-z0-9-]+$/);
  verifyContainers();
  const target = path.join(work, 'c1-proposals.json');
  expect(existsSync(target), 'Never silently overwrite earlier ticket evidence').toBe(false);
  const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
  const keys = localKeys();
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== keys.api) throw Error('EXTERNAL_NETWORK_FORBIDDEN');
    return originalFetch(input, init);
  });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', keys.api);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', keys.service);
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', fixtures.encryptionKey);
  vi.stubEnv('OPENAI_API_KEY', '');
  try {
    const proposals = [];
    for (const [kind, active] of [['retail', false], ['information', true], ['quote', true]] as const) {
      const tenant = fixtures.tenants.find((t: { kind: string }) => t.kind === kind);
      const id = randomUUID(), before = `Synthetic ${kind} instructions before C1`, after = `Synthetic ${kind} instructions after C1`;
      sql(`insert into public.ai_agents(id,business_id,name,instructions,is_active) values(${quote(id)},${quote(tenant.id)},'C1 synthetic agent',${quote(before)},${active});`);
      const plan = await prepareProposal({ businessId: tenant.id, userId: tenant.userId, modules: tenant.modules, catalogSource: 'internal' },
        { action: 'agent_update', id, message: 'Synthetic intent; no model planning', changes: [{ field: 'instructions', value: after }] }, 'UTC');
      expect(plan.token).toBeTruthy();
      expect(plan.preview?.agentConfiguration).toMatchObject({ agentId: id, active });
      expect(sql(`select instructions from public.ai_agents where id=${quote(id)};`)).toBe(before);
      proposals.push({ kind, id, active, before, after, hash: createHash('sha256').update(after).digest('hex'), plan });
    }
    writeFileSync(target, JSON.stringify(proposals, null, 2), { mode: 0o600 });
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});
