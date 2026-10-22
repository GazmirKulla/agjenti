// Audit-only. Actual deterministic application modules; no source edits or SDK install.
// runtime.ts re-exports guidance.ts, which imports OpenAI even though these tests
// supply explicit intents. Resolve only that unused SDK to a throwing constructor.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
globalThis.__qaOpenAIAttempts = 0;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'openai') return {
    shortCircuit: true,
    url: 'data:text/javascript,' + encodeURIComponent('export default class OpenAI { constructor() { globalThis.__qaOpenAIAttempts++; throw new Error("QA_OPENAI_FORBIDDEN"); } }'),
  };
  return nextResolve(specifier, context);
} });
const { simulateWorkflowProposal } = await import('../../../src/lib/workflows/visual/simulation.ts');
const { evaluatePublicationPolicy } = await import('../../../src/lib/workflows/visual/publication-policy.ts');
const { advanceVisualWorkflow } = await import('../../../src/lib/workflows/visual/runtime.ts');
const { validateVisualGraph, upgradeVisualGraph } = await import('../../../src/lib/workflows/visual/model.ts');
const node = (id, kind, config = {}) => ({ id, kind, label: id, position: { x: 0, y: 0 }, config });
function collectGraph() {
  return { version: 1, name: 'Synthetic local collection', nodes: [node('start', 'start'), node('email', 'collect', { fieldKey: 'email', fieldType: 'email', prompt: 'Email?' }), node('end', 'end')],
    edges: [{ id: 'first', source: 'start', target: 'email', port: 'next' }, { id: 'last', source: 'email', target: 'end', port: 'next' }] };
}
function confirmGraph() {
  return { version: 1, name: 'Synthetic local confirmation', nodes: [node('start', 'start'), node('confirm', 'confirm', { prompt: 'Continue?' }), node('accepted', 'end'), node('declined', 'end')],
    edges: [{ id: 'first', source: 'start', target: 'confirm', port: 'next' }, { id: 'yes', source: 'confirm', target: 'accepted', port: 'yes' }, { id: 'no', source: 'confirm', target: 'declined', port: 'no' }] };
}
function externalGraph(kind) {
  const graph = collectGraph();
  graph.nodes[1] = node('email', kind);
  if (kind === 'handoff') { graph.nodes.pop(); graph.edges.pop(); }
  return graph;
}
const simulate = graph => simulateWorkflowProposal({ proposalId: 'audit-proposal', baseRevision: 1, before: graph, candidate: graph, capabilities: [] });
const policy = graph => ({ mode: 'assistant_strict', businessId: 'synthetic-business', userId: 'synthetic-user', authorized: true,
  revision: 1, currentRevision: 1, candidate: graph, currentDraft: graph, publishedVersionId: null, expectedPublishedVersionId: null,
  proposalId: 'audit-proposal', requestId: 'audit-request', capabilities: [], simulation: simulate(graph), confirming: false });

test('local collection passes with executed structural evidence', () => {
  const result = simulate(collectGraph());
  assert.equal(result.result, 'PASS'); assert.equal(result.canPublish, true);
  assert.ok(result.scenarios.every(s => s.executionCount > 0));
});
test('prompt semantics remain explicitly outside a structural PASS', () => {
  const graph = collectGraph(); graph.nodes[1].config.prompt = 'What is your telephone number?';
  const result = simulate(graph);
  assert.equal(result.result, 'PASS');
  assert.ok(result.validationFindings.some(f => f.code === 'structural_scope' && f.message.includes('përmbajtja e përgjigjeve')));
  // This control documents a limit, not a claimed runtime/safety defect.
});
for (const kind of ['knowledge', 'product', 'handoff']) test(`${kind} boundary cannot receive overall PASS`, () => {
  const result = simulate(externalGraph(kind));
  assert.equal(result.result, 'UNVERIFIED'); assert.equal(result.canPublish, false);
  assert.ok(result.scenarios.some(s => s.attemptedActions.some(a => a.kind === kind && a.disposition === 'not_executed')));
});
test('local v2 graph declines to certify hub selection', () => {
  const result = simulate(upgradeVisualGraph(collectGraph()));
  assert.equal(result.result, 'UNVERIFIED'); assert.equal(result.canPublish, false);
  assert.ok(result.scenarios.some(s => s.scenarioId === 'hub_unverified'));
});
test('manual compatibility is explicitly UNVERIFIED', () => {
  const result = evaluatePublicationPolicy({ ...policy(collectGraph()), mode: 'manual_legacy', simulation: undefined });
  assert.equal(result.result, 'UNVERIFIED'); assert.equal(result.canPublish, true);
});
test('assistant strict blocks unverified external action evidence', () => {
  const result = evaluatePublicationPolicy(policy(externalGraph('knowledge')));
  assert.equal(result.result, 'UNVERIFIED'); assert.equal(result.canPublish, false); assert.equal(result.canRequestApproval, false);
});
test('assistant strict rejects stale simulation binding', () => {
  const input = policy(collectGraph()); input.simulation.baseRevision++;
  const result = evaluatePublicationPolicy(input);
  assert.equal(result.status, 'stale_proposal'); assert.equal(result.canPublish, false);
});
for (const [message, target, port] of [['po', 'accepted', 'yes'], ['jo', 'declined', 'no']]) test(`runtime ${message} follows freshly presented confirmation`, () => {
  const graph = confirmGraph(); assert.deepEqual(validateVisualGraph(graph).errors, []);
  const presented = advanceVisualWorkflow({ graph, versionId: 'fixture-v1', message: '', hasPhoto: false, intent: 'unknown' });
  assert.equal(presented.action.kind, 'prompt'); assert.ok(presented.state.pendingConfirmation);
  const answered = advanceVisualWorkflow({ graph, versionId: 'fixture-v1', state: presented.state, message, hasPhoto: false, intent: 'unknown' });
  assert.equal(answered.action.kind, 'end'); assert.equal(answered.action.nodeId, target); assert.equal(answered.state.branchPorts.confirm, port);
});
test('BUG SIM-01: valid confirm graph must pass both simulator branch cases', () => {
  const result = simulate(confirmGraph());
  const branches = result.scenarios.filter(s => s.scenarioId.startsWith('branch:confirm:'));
  assert.deepEqual(branches.map(s => ({ id: s.scenarioId, result: s.result, port: s.selectedBranches.confirm })), [
    { id: 'branch:confirm:yes', result: 'PASS', port: 'yes' },
    { id: 'branch:confirm:no', result: 'PASS', port: 'no' },
  ]);
  assert.ok(branches[0].traversedNodeIds.includes('accepted'));
  assert.ok(branches[1].traversedNodeIds.includes('declined'));
});
test('BUG SIM-01: valid local confirmation should reach assistant approval gate', () => {
  const result = evaluatePublicationPolicy(policy(confirmGraph()));
  assert.equal(result.status, 'approval_required'); assert.equal(result.canRequestApproval, true);
  assert.equal(result.canPublish, false); // Explicit user approval is still required.
});
after(() => assert.equal(globalThis.__qaOpenAIAttempts, 0, 'No model-provider execution is permitted'));
