import { describe, expect, it } from "vitest";
import { normalizeVisualDraft, starterVisualGraph, upgradeVisualGraph, validateVisualGraph } from "./model";

function bookingGraph() {
  const graph = upgradeVisualGraph(starterVisualGraph());
  graph.nodes.push({id:"booking",kind:"booking",label:"Rezervimet",position:{x:600,y:700},config:{}});
  graph.edges.push({id:"booking-end",source:"booking",target:"end",port:"next"});
  graph.flows.push({id:"booking",kind:"booking",label:"Rezervimet",entryNodeId:"booking",nodeIds:["booking"]});
  return graph;
}

function orderStatusGraph() {
  const graph = upgradeVisualGraph(starterVisualGraph());
  graph.nodes.push({ id: "order-status", kind: "order_status", label: "Statusi i porosisë", position: { x: 600, y: 700 }, config: {} });
  graph.edges.push({ id: "order-status-end", source: "order-status", target: "end", port: "next" });
  graph.flows.push({ id: "order-status", kind: "information", label: "Statusi i porosisë", entryNodeId: "order-status", nodeIds: ["order-status"] });
  return graph;
}

describe("message hub definition compatibility", () => {
  it("round trips product and service assignments without changing the source graph", () => {
    const graph = upgradeVisualGraph(starterVisualGraph());
    graph.flows[0].productIds = ["AAAAAAAA-0000-4000-8000-000000000001"];
    graph.flows[1].serviceIds = ["bbbbbbbb-0000-4000-8000-000000000002"];
    const original = structuredClone(graph);
    const normalized = normalizeVisualDraft(graph);
    expect(normalized?.version === 2 && normalized.flows[0].productIds).toEqual(["aaaaaaaa-0000-4000-8000-000000000001"]);
    expect(normalized?.version === 2 && normalized.flows[1].serviceIds).toEqual(graph.flows[1].serviceIds);
    expect(validateVisualGraph(graph).errors).toEqual([]);
    expect(graph).toEqual(original);
  });

  it.each(["productIds", "serviceIds"] as const)("rejects malformed, oversized and ambiguous %s assignments", field => {
    const id = "aaaaaaaa-0000-4000-8000-000000000001";
    for (const values of [null, "all", ["not-an-id"], [id, id.toUpperCase()], Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)]) {
      const graph = upgradeVisualGraph(starterVisualGraph());
      Object.assign(graph.flows[0], { [field]: values });
      expect(normalizeVisualDraft(graph)).toBeNull();
    }
    const graph = upgradeVisualGraph(starterVisualGraph());
    graph.flows[0][field] = [id]; graph.flows[1][field] = [id.toUpperCase()];
    expect(normalizeVisualDraft(graph)).toBeNull();
    graph.flows[1][field] = [];
    expect(validateVisualGraph(graph).errors).toEqual([]);
  });

  it("upgrades a working copy while keeping v1 nodes, edges and original unchanged", () => {
    const original = starterVisualGraph(), graph = upgradeVisualGraph(original);
    expect(original.version).toBe(1);
    expect(graph.nodes).toEqual(original.nodes);
    expect(graph.edges).toEqual(original.edges);
    expect(graph.flows.map(f=>f.kind)).toEqual(["support","order","information"]);
    expect(validateVisualGraph(graph).errors).toEqual([]);
    graph.flows[0].label = "Modified";
    expect(starterVisualGraph()).toEqual(original);
  });

  it("round trips grouped configuration and allows disconnected hub entry with an existing booking adapter", () => {
    const graph = bookingGraph();
    expect(normalizeVisualDraft(graph)?.version).toBe(2);
    expect(normalizeVisualDraft(graph)).toEqual(graph);
    expect(validateVisualGraph(graph).errors).toEqual([]);
    expect(validateVisualGraph({...graph, version:1}).graph).toBeUndefined();
  });

  it("publishes an order-status capability as its own information flow in v2 only", () => {
    const graph = orderStatusGraph();
    expect(normalizeVisualDraft(graph)).toEqual(graph);
    expect(validateVisualGraph(graph).errors).toEqual([]);
    expect(normalizeVisualDraft({ ...graph, version: 1 })).toBeNull();
    expect(graph.nodes.find(node => node.id === "knowledge")?.kind).toBe("knowledge");
  });

  it("requires the status response to have a next step and rejects immediate status loops", () => {
    const graph = orderStatusGraph();
    graph.edges = graph.edges.filter(edge => edge.source !== "order-status");
    expect(validateVisualGraph(graph).errors).toContainEqual({ nodeId: "order-status", message: "Lidh daljen Vazhdo me një hap." });
    graph.edges.push({ id: "order-status-loop", source: "order-status", target: "order-status", port: "next" });
    expect(validateVisualGraph(graph).errors.some(error => error.message.includes("cikël"))).toBe(true);
  });

  it("rejects ambiguous membership and invalid entry references", () => {
    for (const change of ["duplicate", "missing", "terminal", "absent-id", "absent-flow-id"] as const) {
      const graph = bookingGraph();
      if (change === "duplicate") graph.flows[0].nodeIds.push("booking");
      if (change === "missing") graph.flows.at(-1)!.entryNodeId = "unknown";
      if (change === "terminal") { graph.flows.at(-1)!.entryNodeId="end"; graph.flows.at(-1)!.nodeIds=["end"]; }
      if (change === "absent-id") graph.flows.at(-1)!.nodeIds.push("absent");
      if (change === "absent-flow-id") delete (graph.flows.at(-1)! as {id?:string}).id;
      expect(normalizeVisualDraft(graph),change).toBeNull();
    }
  });

  it("keeps draft editing permissive but requires named hub flows to publish", () => {
    const graph = bookingGraph();
    graph.flows[0].label="";
    expect(normalizeVisualDraft(graph)).not.toBeNull();
    expect(validateVisualGraph(graph).graph).toBeUndefined();
    graph.flows=[];
    expect(normalizeVisualDraft(graph)).not.toBeNull();
    expect(validateVisualGraph(graph).graph).toBeUndefined();
  });

  it("allows a booking wait cycle while rejecting instant cycles in another branch", () => {
    const graph=bookingGraph();
    graph.edges.find(e=>e.source==="booking")!.target="booking";
    expect(validateVisualGraph(graph).errors).toEqual([]);
    graph.edges.find(e=>e.source==="knowledge")!.target="knowledge";
    expect(validateVisualGraph(graph).errors.some(e=>e.message.includes("cikël"))).toBe(true);
  });
});
