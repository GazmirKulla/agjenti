import test from 'node:test';
import assert from 'node:assert/strict';
import { matches, rankCatalogs } from '../../../src/lib/catalogs/ranking.ts';
import { emptyMetadata } from '../../../src/lib/catalogs/model.ts';
for (const [supported, requested] of [['UK', 'Ukraine'], ['US', 'Russia'], ['US', 'Australia']]) test(`BUG QA-004: ${supported} is not the distinct country ${requested}`, () => assert.equal(matches([supported], requested), false));
test('BUG QA-004: full catalog ranking rejects a UK-only document for Ukraine', () => {
  const catalog = { id: 'qa-doc', business_id: 'qa-tenant', title: 'Industrial pumps catalog', source_type: 'pdf', source_url: null, storage_path: 'qa/pumps.pdf', description: 'Industrial pumps', metadata: { ...emptyMetadata, markets: ['UK'] }, ai_summary: '', use_when: ['full_range'], qualification_fields: ['market'], active: true, index_status: 'ready', confirmed_at: '2026-10-01', updated_at: '2026-10-01', share_token: 'a'.repeat(64), revision: 1, index_error: null, coverage: 'selective' };
  const hits = [{ catalog_id: 'qa-doc', heading: 'Pumps', body: 'UK specification', page: 1, semantic: 0.95 }];
  assert.deepEqual(rankCatalogs([catalog], hits, 'Industrial pumps catalog Ukraine', { market: 'Ukraine' }), []);
});
test('exact known market and language aliases still match', () => { assert.equal(matches(['EN'], 'anglisht'), true); assert.equal(matches(['Germany'], 'gjermani'), true); });
