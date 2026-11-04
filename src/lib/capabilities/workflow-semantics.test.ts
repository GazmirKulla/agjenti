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
  create.mockResolvedValue({ output_text: JSON.stringify({ evidence: keys.map(capabilityKey => ({ capabilityKey, sourceId: "request", quote: request })) }) });
  expect((await reviewWorkflowSemantics(request)).capabilityKeys).toEqual(keys);
  expect(create).toHaveBeenCalledTimes(1);
});
it("rejects invented sources, ungrounded quotes and malformed output", async () => {
  for (const evidence of [null, [{ sourceId: "node:foreign", quote: "x", capabilityKey: "inventory.check" }], [{ sourceId: "request", quote: "invented", capabilityKey: "inventory.check" }]]) {
    create.mockResolvedValue({ output_text: JSON.stringify({ evidence }) });
    await expect(reviewWorkflowSemantics("Hello", emptyVisualGraph())).rejects.toThrow();
  }
});
it("fails closed when the model is missing or unavailable, with no phrase fallback", async () => {
  delete process.env.OPENAI_API_KEY;
  await expect(reviewWorkflowSemantics("Check inventory")).rejects.toThrow("unavailable");
  expect(create).not.toHaveBeenCalled();
  process.env.OPENAI_API_KEY = "test-only";
  create.mockRejectedValue(new Error("provider unavailable"));
  await expect(reviewWorkflowSemantics("Check inventory")).rejects.toThrow();
});
