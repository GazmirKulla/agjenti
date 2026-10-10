import { describe, expect, it } from "vitest";
import { starterVisualGraph, validateVisualGraph } from "@/lib/workflows/visual/model";
import { addFlowTemplate } from "./flow-templates";
import { workflowHubSelection } from "./hub-selection";

describe("manual flow templates", () => {
  it("adds a real order-status action without changing the existing workflow", () => {
    const original = starterVisualGraph(), before = structuredClone(original);
    const { graph, flow } = addFlowTemplate(original, "order_status", "status-first");
    expect(flow).toMatchObject({ kind: "information", label: "Statusi i porosisë", entryNodeId: "status-first" });
    expect(graph.nodes.find(node => node.id === flow.entryNodeId)).toMatchObject({ kind: "order_status", config: {} });
    expect(graph.edges).toContainEqual({ id: "edge_status-first", source: "status-first", target: "status-first_end", port: "next" });
    expect(validateVisualGraph(graph).errors).toEqual([]);
    expect(original).toEqual(before);
    expect(graph.nodes.slice(0, original.nodes.length)).toEqual(before.nodes);
  });

  it("keeps status and knowledge flows separately selectable by identity", () => {
    const first = addFlowTemplate(starterVisualGraph(), "order_status", "status-first");
    const second = addFlowTemplate(first.graph, "order_status", "status-second");
    expect(second.flow.label).toBe("Statusi i porosisë 2");
    const selection = workflowHubSelection(second.graph.flows, "information");
    expect(selection.action).toBe("choose");
    if (selection.action !== "choose") throw new Error("Expected exact flow choices");
    expect(selection.flows.map(flow => flow.id)).toEqual(["knowledge", first.flow.id, second.flow.id]);
    expect(validateVisualGraph(second.graph).errors).toEqual([]);
  });

  it.each(["information", "order", "booking", "support", "custom"] as const)("keeps the %s template publishable", template => {
    const { graph } = addFlowTemplate(starterVisualGraph(), template, `new-${template}`);
    expect(validateVisualGraph(graph).errors).toEqual([]);
  });
});
