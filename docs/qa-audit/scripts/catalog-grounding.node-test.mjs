// Read-only execution of actual repository modules through the parent audit's
// local TypeScript resolver. No package dependencies, provider calls, or DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matches, rankCatalogs, readContext } from '../../../src/lib/catalogs/ranking.ts';
import { emptyMetadata } from '../../../src/lib/catalogs/model.ts';

const catalog = {
  id: 'uk-document', business_id: 'audit-tenant', title: 'Industrial pumps catalog',
  source_type: 'pdf', source_url: null, storage_path: 'audit-tenant/pumps.pdf',
  description: 'Technical industrial pumps', metadata: { ...emptyMetadata, markets: ['UK'] },
  ai_summary: '', use_when: ['full_range'], qualification_fields: ['market'],
  active: true, index_status: 'ready', confirmed_at: '2026-10-01', updated_at: '2026-10-01',
  share_token: 'a'.repeat(64), revision: 1, index_error: null, coverage: 'selective',
};
for (const [supported, requested] of [['UK', 'Ukraine'], ['US', 'Russia'], ['US', 'Australia']]) {
  test(`distinct market ${requested} must not match ${supported}`, () => assert.equal(matches([supported], requested), false));
}
test('unsupported Ukraine market must eliminate a UK-only catalog before ranking', () => {
  const hits = [{ catalog_id: catalog.id, heading: 'Pumps', body: 'UK specification', page: 1, semantic: 0.95 }];
  assert.deepEqual(rankCatalogs([catalog], hits, 'Industrial pumps catalog Ukraine', { market: 'Ukraine' }), []);
});
test('known language and country aliases still match correctly', () => {
  assert.equal(matches(['EN'], 'anglisht'), true);
  assert.equal(matches(['Germany'], 'gjermani'), true);
  assert.equal(matches(['US'], 'US'), true);
});
test('inactive and unconfirmed catalogs are excluded before generation', () => {
  assert.deepEqual(rankCatalogs([{ ...catalog, active: false }, { ...catalog, confirmed_at: null }], [], 'Industrial pumps catalog', {}), []);
});
test('qualification context validates pending fields and bounds retention', () => {
  assert.deepEqual(readContext({ query: 'pumps', requirements: { market: 'UK', injected: 'command' }, pending: 'market', turns: 1 }),
    { query: 'pumps', requirements: { market: 'UK' }, pending: 'market', turns: 1 });
  assert.equal(readContext({ query: 'pumps', requirements: {}, turns: 99 }), null);
});
