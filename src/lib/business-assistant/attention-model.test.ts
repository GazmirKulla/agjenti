import { expect, it } from "vitest";
import { workflowNeedsAttention } from "./attention-model";
it("tracks a saved draft until it matches the published graph", () => {
  const graph = { name: "Porosia", nodes: [] };
  expect(workflowNeedsAttention(graph, null)).toBe(true);
  expect(workflowNeedsAttention(graph, { ...graph, name: "Old" })).toBe(true);
  expect(workflowNeedsAttention(graph, graph)).toBe(false);
});
