import { describe, expect, it } from "vitest";
import { normalizeVisualDraft, starterVisualGraph, validateVisualGraph } from "./model";
import type { VisualGraph, VisualNode } from "./types";

function node(id: string, kind: VisualNode["kind"], config: VisualNode["config"] = {}): VisualNode {
  return { id, kind, label: id, position: { x: 0, y: 0 }, config };
}
function linear(...steps: VisualNode[]): VisualGraph {
  const nodes = [node("start", "start"), ...steps, node("end", "end")];
  return { version: 1, name: "Test", nodes, edges: nodes.slice(0, -1).map((n, i) => ({ id: `edge-${i}`, source: n.id, target: nodes[i + 1].id, port: "next" })) };
}
function confirmation(): VisualGraph {
  const graph = linear(node("email", "collect", { fieldKey: "email", fieldType: "email", prompt: "Email?" }), node("confirm", "confirm", { prompt: "Konfirmoni?" }));
  graph.edges = graph.edges.filter(edge => edge.source !== "confirm");
  graph.edges.push({ id: "yes", source: "confirm", target: "end", port: "yes" }, { id: "no", source: "confirm", target: "email", port: "no" });
  return graph;
}

describe("visual graph publication", () => {
  it.each(["date", "integer", "enum"])("rejects unsupported field type %s instead of inventing validation", fieldType => {
    const graph = linear(node("configured", "collect", { fieldKey: "preferred_date", prompt: "Configured field?" }));
    expect(normalizeVisualDraft({ ...graph, nodes: graph.nodes.map(n => n.id === "configured" ? { ...n, config: { ...n.config, fieldType } } : n) })).toBeNull();
  });
  it("generates a deterministic connected starter without inventing customer fields", () => {
    const graph = starterVisualGraph();
    expect(starterVisualGraph()).toEqual(graph);
    expect(validateVisualGraph(graph).errors).toEqual([]);
    expect(graph.nodes.some(n => n.kind === "collect")).toBe(false);
  });
  it("saves an unfinished draft while refusing publication", () => {
    const graph = starterVisualGraph();
    graph.edges = [];
    expect(normalizeVisualDraft(graph)).not.toBeNull();
    expect(validateVisualGraph(graph).graph).toBeUndefined();
  });
  it.each(["missing", "duplicate", "unsupported", "dangling"])("rejects %s output routes", kind => {
    const graph = starterVisualGraph();
    if (kind === "missing") graph.edges.shift();
    if (kind === "duplicate") graph.edges.push({ ...graph.edges[0], id: "duplicate" });
    if (kind === "unsupported") graph.edges[0].port = "yes";
    if (kind === "dangling") graph.edges[0].target = "absent";
    expect(validateVisualGraph(graph).errors.length).toBeGreaterThan(0);
  });
  it("rejects unreachable nodes, duplicate IDs, and multiple start nodes", () => {
    for (const extra of [node("unreachable", "end"), node("start", "end"), node("start-two", "start")]) {
      const graph = starterVisualGraph();
      graph.nodes.push(extra);
      expect(validateVisualGraph(graph).graph).toBeUndefined();
    }
  });
  it("rejects an instant loop even when another branch has a terminal", () => {
    const graph = starterVisualGraph();
    graph.edges.find(e => e.source === "knowledge")!.target = "order";
    expect(validateVisualGraph(graph).errors.some(e => e.message.includes("cikël"))).toBe(true);
  });
  it("allows corrections that wait for the next customer reply", () => {
    expect(validateVisualGraph(confirmation()).errors).toEqual([]);
  });
  it("bounds graph size and refuses executable node kinds and reserved field keys", () => {
    const graph = linear(node("email", "collect", { prompt: "Email?", fieldKey: "constructor" }));
    expect(normalizeVisualDraft(graph)).toBeNull();
    expect(normalizeVisualDraft({ ...starterVisualGraph(), nodes: [node("script", "script" as VisualNode["kind"])] })).toBeNull();
    expect(normalizeVisualDraft({ ...starterVisualGraph(), name: "x".repeat(121) })).toBeNull();
  });
});
