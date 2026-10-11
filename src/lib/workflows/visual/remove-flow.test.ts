import { describe, expect, it } from "vitest";
import { addFlowTemplate } from "@/components/workflows/flow-templates";
import { starterVisualGraph, upgradeVisualGraph, validateVisualGraph } from "./model";
import { removeVisualFlow } from "./remove-flow";

describe("removing a draft flow", () => {
  it("removes an accidental information flow and its end without changing other flows or the input", () => {
    const original = upgradeVisualGraph(starterVisualGraph());
    const added = addFlowTemplate(original, "information", "extra");
    const before = structuredClone(added.graph);
    const result = removeVisualFlow(added.graph, added.flow.id);
    expect(result.removedNodeCount).toBe(2);
    expect(result.graph).toEqual(original);
    expect(added.graph).toEqual(before);
    expect(validateVisualGraph(result.graph).errors).toEqual([]);
  });

  it("keeps a shared ending and all remaining edges valid", () => {
    const added = addFlowTemplate(starterVisualGraph(), "information", "extra");
    added.graph.edges.find(edge => edge.source === "extra")!.target = "end";
    added.graph.nodes = added.graph.nodes.filter(node => node.id !== "extra_end");
    const result = removeVisualFlow(added.graph, added.flow.id);
    expect(result.removedNodeCount).toBe(1);
    expect(result.graph?.nodes.some(node => node.id === "end")).toBe(true);
    expect(validateVisualGraph(result.graph).errors).toEqual([]);
  });

  it("blocks deletion when another step depends on a removed node", () => {
    const added = addFlowTemplate(starterVisualGraph(), "information", "extra");
    added.graph.edges.find(edge => edge.source === "knowledge")!.target = "extra";
    const before = structuredClone(added.graph);
    expect(removeVisualFlow(added.graph, added.flow.id)).toEqual({ error: expect.stringContaining("Përgjigju nga njohuritë") });
    expect(added.graph).toEqual(before);
  });

  it("keeps a downstream chain that is also used by another flow", () => {
    const added = addFlowTemplate(starterVisualGraph(), "information", "extra");
    added.graph.nodes.push({ id: "shared", kind: "knowledge", label: "Shared", position: { x: 0, y: 0 }, config: {} });
    added.graph.edges.find(edge => edge.source === "extra")!.target = "shared";
    added.graph.edges.find(edge => edge.source === "knowledge")!.target = "shared";
    added.graph.edges.push({ id: "shared-end", source: "shared", target: "extra_end", port: "next" });
    const result = removeVisualFlow(added.graph, added.flow.id);
    expect(result.removedNodeCount).toBe(1);
    expect(result.graph?.nodes.map(node => node.id)).toEqual(expect.arrayContaining(["shared", "extra_end"]));
    expect(validateVisualGraph(result.graph).errors).toEqual([]);
  });

  it("removes only this flow's bindings and reports the impact", () => {
    const added = addFlowTemplate(starterVisualGraph(), "information", "extra");
    added.graph.flows.find(flow => flow.id === added.flow.id)!.productIds = ["product-a"];
    added.graph.flows.find(flow => flow.id === added.flow.id)!.serviceIds = ["service-a"];
    added.graph.flows[0].productIds = ["product-b"];
    const result = removeVisualFlow(added.graph, added.flow.id);
    expect(result).toMatchObject({ productCount: 1, serviceCount: 1 });
    expect(result.graph?.flows[0].productIds).toEqual(["product-b"]);
  });

  it("rejects an unknown flow without removing anything", () => {
    expect(removeVisualFlow(starterVisualGraph(), "missing").error).toBeTruthy();
  });
});
