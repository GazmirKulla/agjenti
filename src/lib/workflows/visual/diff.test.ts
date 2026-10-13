import { expect, it } from "vitest";
import { starterVisualGraph, upgradeVisualGraph } from "./model";
import { diffHighlights, diffWorkflowGraphs } from "./diff";

it("finds additions, removals and updates by stable ID without modifying snapshots", () => {
  const before = starterVisualGraph(), copy = structuredClone(before), after = structuredClone(before);
  after.nodes = after.nodes.filter(n => n.id !== "knowledge");
  after.nodes.push({ id: "question", kind: "collect", label: "Kontakt", position: { x: 100, y: 100 }, config: { fieldKey: "customer_phone", prompt: "Telefoni?" } });
  after.nodes.find(n => n.id === "product")!.label = "Produkti";
  after.edges = after.edges.filter(e => e.source !== "knowledge" && e.target !== "knowledge");
  after.edges.push({ id: "ask", source: "order", target: "question", port: "no" });
  const diff = diffWorkflowGraphs(before, after);
  expect(diff.nodes.map(c => [c.id, c.kind])).toEqual([["knowledge", "removed"], ["product", "updated"], ["question", "added"]]);
  expect(diff.edges.map(c => [c.id, c.kind])).toEqual([["ask", "added"], ["e5", "removed"], ["e7", "removed"]]);
  expect(diffHighlights(diff, "before").nodes).toEqual({ knowledge: "removed", product: "updated" });
  expect(diffHighlights(diff, "after").nodes).toEqual({ product: "updated", question: "added" });
  expect(before).toEqual(copy);
});
it("treats reordered arrays and object properties as a no-op", () => {
  const before = upgradeVisualGraph(starterVisualGraph()), after = structuredClone(before);
  after.nodes.reverse(); after.edges.reverse(); after.flows.reverse();
  after.flows.forEach(f => f.nodeIds.reverse());
  after.nodes[0].config = { prompt: undefined, ...after.nodes[0].config };
  expect(diffWorkflowGraphs(before, after).empty).toBe(true);
});
it("detects rewiring an existing edge and preserves unrelated flows", () => {
  const before = upgradeVisualGraph(starterVisualGraph()), after = structuredClone(before);
  after.edges.find(e => e.id === "e6")!.target = "knowledge";
  const diff = diffWorkflowGraphs(before, after);
  expect(diff.edges).toMatchObject([{ id: "e6", kind: "updated", fields: ["target"] }]);
  expect(diff.affectedFlowIds).toContain(before.flows.find(f => f.nodeIds.includes("product"))!.id);
  expect(diff.unchangedFlowIds).toContain(before.flows.find(f => f.nodeIds.includes("handoff"))!.id);
  expect(diff.nodes).toEqual([]);
});
it("reports multiple branches affected by a changed shared downstream step", () => {
  const before = upgradeVisualGraph(starterVisualGraph()), after = structuredClone(before);
  after.nodes.find(n => n.id === "end")!.config.prompt = "Faleminderit";
  const diff = diffWorkflowGraphs(before, after);
  expect(diff.affectedFlowIds).toEqual(before.flows.filter(f => f.kind !== "support").map(f => f.id).sort());
  expect(diff.unchangedFlowIds).toEqual(before.flows.filter(f => f.kind === "support").map(f => f.id));
});
it("records flow binding changes independently of node and edge changes", () => {
  const before = upgradeVisualGraph(starterVisualGraph()), after = structuredClone(before);
  after.flows[0].productIds = ["00000000-0000-4000-8000-000000000001"];
  const diff = diffWorkflowGraphs(before, after);
  expect(diff.flows[0].fields).toEqual(["productIds"]); expect(diff.nodes).toEqual([]); expect(diff.edges).toEqual([]);
});
