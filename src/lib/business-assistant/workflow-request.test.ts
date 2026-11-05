import { beforeEach, expect, it, vi } from 'vitest';
const create = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({ default: class { responses = { create }; } }));
import { reviewWorkflowRequest } from './workflow-request';
import { emptyVisualGraph } from '@/lib/workflows/visual/model';
import { visualGraphHash } from '@/lib/workflows/visual/graph-hash';
const graph = emptyVisualGraph();
beforeEach(() => { create.mockReset(); process.env.OPENAI_API_KEY = 'test-only'; });
// Provider observations are explicit test data; these do not measure model accuracy.
it.each([
  ['Ndrysho hapin që të kërkojë emailin', 'publish'],
  ['Update the workflow to ask for email', 'publish'],
  ['Modifica il flusso, ma salvalo solo come bozza', 'draft'],
  ['Mos e ndrysho, vetëm kontrolloje', 'read'],
  ['Propose une modification sans la publier', 'preview'],
  ['Po, atë tjetrin', 'clarify'],
])('validates referenced semantic evidence: %s', async (request, mode) => {
  create.mockResolvedValue({ output_text: JSON.stringify({ mode, quote: request, question: mode === 'clarify' ? 'Cilin propozim?' : '', candidateHash: visualGraphHash(graph), revision: 4 }) });
  const result = await reviewWorkflowRequest(request, [{ role: 'assistant', content: 'Context only' }], graph, graph, 4);
  expect(result.mode).toBe(mode);
  expect(result.expires).toBeGreaterThan(Date.now());
  const input = JSON.parse(create.mock.calls[0][0].input);
  expect(input).toMatchObject({ request, revision: 4, candidateHash: visualGraphHash(graph), candidate: graph, before: graph });
});
it('rejects invented evidence and foreign or stale snapshots', async () => {
  const valid = { mode: 'publish', quote: 'Change', question: '', candidateHash: visualGraphHash(graph), revision: 4 };
  for (const invalid of [{ quote: 'Publish everything' }, { candidateHash: 'other' }, { revision: 3 }, { mode: 'unknown' }, { question: 'Which one?' }]) {
    create.mockResolvedValue({ output_text: JSON.stringify({ ...valid, ...invalid }) });
    await expect(reviewWorkflowRequest('Change', [], graph, graph, 4)).rejects.toThrow();
  }
});
it('does not fall back to interpreting phrases when the model fails', async () => {
  create.mockRejectedValue(new Error('offline'));
  await expect(reviewWorkflowRequest('Publish it now', [], graph, graph, 4)).rejects.toThrow('offline');
});
