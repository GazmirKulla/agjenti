import { expect, it } from "vitest";
import { starterVisualGraph, upgradeVisualGraph } from "@/lib/workflows/visual/model";
import { semanticChangeFocus, summarizeWorkflowChanges } from "./semantic-summary";
import type { AutomationProposal } from "./automation-proposal";

it("explains a new condition and both of its branches without guaranteeing execution", () => {
  const before = starterVisualGraph(), after = structuredClone(before);
  after.nodes.push({ id: "phone", kind: "condition", label: "Kontakt", position: { x: 200, y: 20 }, config: { condition: "field_present", fieldKey: "customer_phone" } });
  after.edges.push({ id: "phone-yes", source: "phone", target: "product", port: "yes" }, { id: "phone-no", source: "phone", target: "handoff", port: "no" });
  const result = summarizeWorkflowChanges(before, after, 7, "v1");
  expect(result).toMatchObject({ baseRevision: 7, publishedVersionId: "v1", simulationRequired: true });
  expect(result.changes.find(c => c.id === "step:phone")).toMatchObject({ kind: "added", conditionChanged: true });
  expect(result.changes.find(c => c.id === "route:phone-yes")?.after).toContain("Po: Vazhdimi i procesit të produktit");
  expect(result.changes.find(c => c.id === "route:phone-no")?.after).toContain("Jo: Orientimi te stafi");
  expect(result.unverifiedBehavior.join()).toContain("Nuk është kryer simulim");
});
it("marks prompt edits unverified rather than adopting claims or revealing credentials", () => {
  const before = starterVisualGraph(), after = structuredClone(before);
  after.nodes.find(n => n.id === "knowledge")!.config.prompt = "Guaranteed inventory and notifications. api_key=secret-test-value";
  const result = summarizeWorkflowChanges(before, after, 2, null);
  expect(result.changes[0]).toMatchObject({ promptChanged: true, requiresSimulation: true });
  expect(JSON.stringify(result)).not.toContain("secret-test-value");
  expect(JSON.stringify(result)).not.toContain("Guaranteed");
  expect(result.inferredBehavior).toHaveLength(1);
});
it("explains removal and selects the old snapshot", () => {
  const before = starterVisualGraph(), after = structuredClone(before);
  after.nodes = after.nodes.filter(n => n.id !== "product");
  after.edges = after.edges.filter(e => e.source !== "product" && e.target !== "product");
  const result = summarizeWorkflowChanges(before, after, 2, null);
  const removed = result.changes.find(c => c.id === "step:product")!;
  expect(removed.after).toBe("Nuk përfshihet në këtë version.");
  expect(semanticChangeFocus(removed)).toEqual({ side: "before", nodeId: "product" });
});
it("tracks condition value edits without leaking the configured comparison value", () => {
  const before = starterVisualGraph(), after = structuredClone(before);
  after.nodes.find(n => n.id === "order")!.config = { condition: "field_equals", fieldKey: "credential", value: "sensitive-value" };
  const result = summarizeWorkflowChanges(before, after, 2, null);
  expect(result.changes[0].conditionChanged).toBe(true);
  expect(JSON.stringify(result)).not.toContain("sensitive-value");
});
it("does not invent behavior or simulation requirements for empty or layout-only changes", () => {
  const before = starterVisualGraph(), after = structuredClone(before);
  expect(summarizeWorkflowChanges(before, after, 2, null)).toMatchObject({ changes: [], inferredBehavior: [], simulationRequired: false });
  after.nodes[0].position.x += 10;
  expect(summarizeWorkflowChanges(before, after, 2, null)).toMatchObject({ inferredBehavior: [], simulationRequired: false });
});
it("keeps unsupported capabilities and configuration separate from structural changes", () => {
  const graph = starterVisualGraph();
  const automation = { unsupportedActions: ["inventory.check"], missingRequirements: ["active_products"] } as AutomationProposal;
  const result = summarizeWorkflowChanges(graph, graph, 2, null, automation);
  expect(result).toMatchObject({ changes: [], unsupportedCapabilities: ["inventory.check"], requiredConfiguration: ["active_products"] });
});
it("describes complex branch changes and marks unaffected flows explicitly", () => {
  const before = upgradeVisualGraph(starterVisualGraph()), after = structuredClone(before);
  after.edges.find(e => e.id === "e6")!.target = "knowledge";
  after.nodes.find(n => n.id === "knowledge")!.config.prompt = "Sqarim";
  const result = summarizeWorkflowChanges(before, after, 2, null);
  expect(result.changes.map(c => c.id)).toEqual(["step:knowledge", "route:e6"]);
  expect(result.affectedFlows).toHaveLength(2); expect(result.unchangedFlows).toHaveLength(1);
});
