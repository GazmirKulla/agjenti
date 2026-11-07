import { expect, it } from "vitest";
import { addFlowTemplate } from "@/components/workflows/flow-templates";
import { starterVisualGraph, validateVisualGraph, normalizeVisualDraft } from "./model";
import { diffWorkflowGraphs } from "./diff";

const fixture = () => addFlowTemplate(starterVisualGraph(), "business_provision", "registration").graph;

it("preserves versioned input mapping through save and flags changes in review", () => {
  const graph = fixture();
  expect(validateVisualGraph(graph).errors).toEqual([]);
  const normalized = normalizeVisualDraft(graph)!;
  expect(normalized.nodes.find(n => n.kind === "action")?.config.action?.inputs.email).toBe("email_registration");
  const changed = structuredClone(graph);
  changed.nodes.find(n => n.kind === "action")!.config.action!.inputs.email = "new_email";
  expect(diffWorkflowGraphs(graph, changed).nodes[0].fields).toContain("config");
});

it("blocks unknown action contracts and missing required input bindings", () => {
  const graph = fixture(), node = graph.nodes.find(n => n.kind === "action")!;
  delete node.config.action!.inputs.email;
  expect(validateVisualGraph(graph).errors).not.toEqual([]);
  (node.config.action as unknown as { actionVersion: number }).actionVersion = 2;
  expect(normalizeVisualDraft(graph)).toBeNull();
});
