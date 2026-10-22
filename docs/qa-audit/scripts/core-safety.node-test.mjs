import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../../../src/lib/workflows/engine.ts';
import { advanceSharedOrder, freshOrderReview, migrateContext, setFact, setOrderTerms, safeFieldKey } from '../../../src/lib/workflows/context.ts';
import { restoreOrder, migrateConversationProcesses, snapshotOrder, bookingAdapterState } from '../../../src/lib/workflows/conversation-processes.ts';
import { createIsolatedExecution, runWithExecution, IsolationViolation, snapshotExternalActions, isIsolatedExecution } from '../../../src/lib/runtime/execution-context.ts';
import { guardIsolatedClient } from '../../../src/lib/runtime/isolated-client.ts';
import { matchingCatalogNames } from '../../../src/lib/products/match-name.ts';
import { usesSharedCoordinator } from '../../../src/lib/conversations/coordinator-policy.ts';
const steps = [{ key: 'size', kind: 'text', label: 'Size' }, { key: 'customer', kind: 'customer' }];
function reviewing() {
  const state = migrateContext(emptyState());
  state.product_id = 'audit-product'; state.step_key = 'customer';
  state.context.execution.linear = { id: 'flow', versionId: 'immutable-v1', name: 'Order', steps };
  setOrderTerms(state, { id: 'audit-product', price_amount: 100, currency: 'ALL' });
  for (const [key, value] of Object.entries({ name: 'Synthetic QA', phone: '0691111111', city: 'Test', address: 'Test only' })) setFact(state, `customer_${key}`, value, 'text', 'customer');
  setFact(state, 'size', 'M', 'text', 'customer');
  return advanceSharedOrder(state, '', false, steps);
}
for (const channel of ['instagram', 'whatsapp']) test(`live ${channel} selects shared coordinator without pilot flag`, () => {
  assert.equal(usesSharedCoordinator({ businessId: 'audit', source: channel, mode: 'production' }), true);
});
test('exact and typo product names remain tenant-catalog bounded', () => {
  const entries = [{ id: 'a', name: 'Aktivitetet Montessori' }, { id: 'b', name: 'Kafshët dhe Natyra' }];
  assert.deepEqual(matchingCatalogNames(entries, 'Dua te porosis montesori'), [entries[0]]);
  assert.deepEqual(matchingCatalogNames(entries, 'A product that does not exist'), []);
});
test('ambiguous product variants return both candidates', () => {
  const entries = [{ name: 'Montessori 3+' }, { name: 'Montessori 5+' }];
  assert.deepEqual(matchingCatalogNames(entries, 'dua montesori'), entries);
  assert.deepEqual(matchingCatalogNames(entries, 'Montessori 5+'), [entries[1]]);
});
test('SKU digit typos do not fuzzy-match', () => assert.deepEqual(matchingCatalogNames([{ name: 'AB123456' }], 'AB123457'), []));
test('new shared order requires explicit review confirmation', () => {
  const state = reviewing(); assert.equal(state.step_key, 'order_confirm');
  assert.equal(freshOrderReview(state, true), false);
  const confirmed = advanceSharedOrder(state, 'Po', false, steps);
  assert.equal(confirmed.step_key, 'order_ready'); assert.equal(freshOrderReview(confirmed, true), true);
});
for (const change of ['product', 'phone', 'size', 'version', 'expired', 'missing', 'price', 'currency']) test(`stale ${change} invalidates order consent`, () => {
  const state = reviewing();
  if (change === 'product') state.product_id = 'other';
  if (change === 'phone') setFact(state, 'customer_phone', '0692222222', 'phone', 'correction');
  if (change === 'size') setFact(state, 'size', 'L', 'text', 'correction');
  if (change === 'version') state.context.execution.linear.versionId = 'v2';
  if (change === 'expired') state.context.execution.orderReview.expiresAt = Date.now() - 1;
  if (change === 'missing') delete state.context.execution.orderReview;
  if (change === 'price') setOrderTerms(state, { id: 'audit-product', price_amount: 101, currency: 'ALL' });
  if (change === 'currency') setOrderTerms(state, { id: 'audit-product', price_amount: 100, currency: 'EUR' });
  assert.equal(freshOrderReview(state), false);
  assert.equal(advanceSharedOrder(state, 'Po', false, steps).step_key, 'order_confirm');
});
test('duplicate yes does not extend confirmation receipt', () => {
  const first = advanceSharedOrder(reviewing(), 'Po', false, steps);
  assert.deepEqual(advanceSharedOrder(first, 'Po', false, steps).context.execution.orderReview, first.context.execution.orderReview);
});
test('canonical current facts win over stale task snapshot', () => {
  const state = migrateConversationProcesses(reviewing(), () => 'task');
  setFact(state, 'size', 'L', 'text', 'correction'); state.product_id = 'another';
  const resumed = restoreOrder(state); assert.equal(resumed.product_id, 'another'); assert.equal(resumed.context.order.size.value, 'L');
});
test('booking profile correction invalidates suspended order consent without changing pinned version', () => {
  const state = migrateConversationProcesses(reviewing(), () => 'task');
  const confirmed = advanceSharedOrder(state, 'Po', false, steps); confirmed.processes.order.snapshot = snapshotOrder(confirmed);
  const booking = bookingAdapterState(confirmed); setFact(booking, 'customer_phone', '0692222222', 'phone', 'correction');
  const resumed = restoreOrder(booking, { resume: true });
  assert.equal(resumed.customer.phone, '0692222222'); assert.equal(resumed.context.execution.linear.versionId, 'immutable-v1'); assert.equal(freshOrderReview(resumed, true), false);
});
test('dangerous dynamic field keys are rejected', () => { for (const value of ['__proto__','constructor','prototype','has spaces']) assert.equal(safeFieldKey(value), false); });
test('isolated execution cannot be switched back to live', () => runWithExecution(createIsolatedExecution(), () => {
  assert.throws(() => runWithExecution({ kind: 'live', isolationLocked: false, effects: [], adapters: {} }, () => {}), IsolationViolation); assert.equal(isIsolatedExecution(), true);
}));
test('isolated database writes and unapproved RPCs fail before underlying client executes', () => runWithExecution(createIsolatedExecution(), () => {
  let calls = 0; const db = guardIsolatedClient({ from: () => ({ insert: () => calls++ }), rpc: () => calls++ });
  assert.throws(() => db.from('orders').insert({}), IsolationViolation); assert.throws(() => db.rpc('submit_confirmed_order'), IsolationViolation); assert.equal(calls, 0); assert.equal(snapshotExternalActions().length, 2);
}));
test('known read-only RPC is allowed in isolated execution', () => runWithExecution(createIsolatedExecution(), () => {
  const db = guardIsolatedClient({ rpc: name => name }); assert.equal(db.rpc('workflow_runtime_readiness'), 'workflow_runtime_readiness');
}));
test('BUG QA-001: necessary entitlement read must work inside isolated test mode', () => runWithExecution(createIsolatedExecution(), () => {
  const db = guardIsolatedClient({ rpc: name => ({ data: name === 'allowed_business_modules' ? ['knowledge'] : [], error: null }) });
  assert.doesNotThrow(() => db.rpc('allowed_business_modules', { p_business: 'audit' }));
}));
