import { beforeEach, expect, it, vi } from "vitest";
vi.unmock("./workflow-semantics");
const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({ default: class { responses = { create }; } }));
import { reviewWorkflowSemantics } from "./workflow-semantics";
import { emptyVisualGraph } from "@/lib/workflows/visual/model";
beforeEach(() => { create.mockReset(); process.env.OPENAI_API_KEY = "test-only"; });
it.each([
  ["Mos kontrollo stokun; hiqe atë veprim", []],
  ["We do not sell products; remove ordering", []],
  ["Voglio sapere cosa significa inventario, non verificarlo", []],
  ["Préviens le client quand le produit redevient disponible", ["back_in_stock.notify"]],
])("uses structured contextual observations, including negation: %s", async (request, keys) => {
  create.mockResolvedValue({ output_text: JSON.stringify({ behaviors: [], evidence: keys.map(capabilityKey => ({ scope: "runtime", capabilityKey, sourceId: "request", quote: request })) }) });
  expect((await reviewWorkflowSemantics(request)).capabilityKeys).toEqual(keys);
  expect(create).toHaveBeenCalledTimes(1);
});
it("rejects invented sources, ungrounded quotes and malformed output", async () => {
  for (const evidence of [null, [{ scope: "runtime", sourceId: "node:foreign", quote: "x", capabilityKey: "inventory.check" }], [{ scope: "runtime", sourceId: "request", quote: "invented", capabilityKey: "inventory.check" }]]) {
    create.mockResolvedValue({ output_text: JSON.stringify({ behaviors: [], evidence }) });
    await expect(reviewWorkflowSemantics("Hello", emptyVisualGraph())).rejects.toThrow();
  }
});
it("fails closed when the model is missing or unavailable, with no phrase fallback", async () => {
  delete process.env.OPENAI_API_KEY;
  await expect(reviewWorkflowSemantics("Check inventory")).rejects.toMatchObject({ reason: "unavailable" });
  expect(create).not.toHaveBeenCalled();
  process.env.OPENAI_API_KEY = "test-only";
  create.mockRejectedValue(new Error("provider unavailable"));
  await expect(reviewWorkflowSemantics("Check inventory")).rejects.toThrow();
});

it("separates owner authoring from runtime requirements using referenced evidence", async () => {
  const request = "Ruaje ndryshimin e workflow-t; klienti duhet vetëm të kalojë te stafi.";
  const behaviors = [{ description: "Ruaj workflow-n", capabilityKeys: ["workflow.save"] }, { description: "Kalo te stafi", capabilityKeys: ["staff.handoff"] }];
  create.mockResolvedValue({ output_text: JSON.stringify({ behaviors: [
    { index: 0, scope: "authoring", quote: "Ruaj workflow-n" }, { index: 1, scope: "runtime", quote: "Kalo te stafi" },
  ], evidence: [{ scope: "authoring", sourceId: "request", quote: "Ruaje ndryshimin e workflow-t", capabilityKey: "workflow.save" }] }) });
  expect(await reviewWorkflowSemantics(request, undefined, behaviors)).toMatchObject({ authoringBehaviorIndexes: [0], capabilityKeys: [] });
});
it("does not allow a candidate's operational claims to be dismissed as owner edits", async () => {
  const graph = emptyVisualGraph(); graph.nodes[1].config.prompt = "Save a workflow for each customer";
  create.mockResolvedValue({ output_text: JSON.stringify({ behaviors: [], evidence: [{ scope: "authoring", sourceId: "node:end", quote: "Save a workflow", capabilityKey: "workflow.save" }] }) });
  await expect(reviewWorkflowSemantics("", graph)).rejects.toMatchObject({ reason: "invalid_response" });
});
it("rejects missing, out-of-range or ungrounded behavior classifications", async () => {
  const behaviors = [{ description: "Save draft", capabilityKeys: ["workflow.save"] }];
  for (const scopes of [[], [{ index: 8, scope: "authoring", quote: "Save draft" }], [{ index: 0, scope: "authoring", quote: "Invented" }]]) {
    create.mockResolvedValue({ output_text: JSON.stringify({ behaviors: scopes, evidence: [] }) });
    await expect(reviewWorkflowSemantics("Save draft", undefined, behaviors)).rejects.toThrow();
  }
});

it('reuses identical interpretation only within one operation and never across changed graphs', async () => {
  const { withWorkflowSemanticReviews } = await import('./workflow-semantics');
  create.mockResolvedValue({ output_text: JSON.stringify({ behaviors: [], evidence: [] }) });
  const graph = emptyVisualGraph();
  await withWorkflowSemanticReviews(async () => {
    const first = await reviewWorkflowSemantics('', graph);
    first.capabilityKeys.push('forged');
    expect((await reviewWorkflowSemantics('', graph)).capabilityKeys).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1);
    await reviewWorkflowSemantics('', { ...graph, name: 'Changed' });
    expect(create).toHaveBeenCalledTimes(2);
  });
  await withWorkflowSemanticReviews(() => reviewWorkflowSemantics('', graph));
  expect(create).toHaveBeenCalledTimes(3);
});
it('reports provider failures without leaking provider response bodies', async () => {
  create.mockRejectedValue(Object.assign(new Error('secret provider body'), { status: 403 }));
  await expect(reviewWorkflowSemantics('', emptyVisualGraph())).rejects.toMatchObject({ reason: 'provider_access' });
  try { await reviewWorkflowSemantics('', emptyVisualGraph()); } catch (error) { expect((error as Error).message).not.toContain('secret provider body'); }
});
