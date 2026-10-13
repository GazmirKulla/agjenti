import type { VisualEdge, VisualFlow, VisualGraph, VisualNode } from "./types";

export type ChangeKind = "added" | "updated" | "removed";
export type GraphChange<T> = { id: string; kind: ChangeKind; before?: T; after?: T; fields: string[] };
export type WorkflowDiff = {
  nodes: GraphChange<VisualNode>[];
  edges: GraphChange<VisualEdge>[];
  flows: GraphChange<VisualFlow>[];
  affectedFlowIds: string[];
  unchangedFlowIds: string[];
  metadata: ("name" | "version")[];
  empty: boolean;
};

// Object property order is not a graph change. IDs and flow membership are sets.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(",")}]`;
  if (value && typeof value === "object") return JSON.stringify(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return JSON.stringify(value) ?? "undefined";
}
function changes<T extends { id: string }>(before: T[], after: T[]): GraphChange<T>[] {
  const old = new Map(before.map(item => [item.id, item])), next = new Map(after.map(item => [item.id, item]));
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap(id => {
    const a = old.get(id), b = next.get(id);
    if (canonical(a) === canonical(b)) return [];
    const fields = a && b ? [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter(key => canonical(a[key as keyof T]) !== canonical(b[key as keyof T])) : [];
    return [{ id, kind: !a ? "added" as const : !b ? "removed" as const : "updated" as const, before: a, after: b, fields }];
  });
}

/** Pure snapshot comparison; never applies patches, upgrades graphs or mutates either input. */
export function diffWorkflowGraphs(before: VisualGraph, after: VisualGraph): WorkflowDiff {
  const nodes = changes(before.nodes, after.nodes), edges = changes(before.edges, after.edges);
  const oldFlows = before.version === 2 ? before.flows : [], newFlows = after.version === 2 ? after.flows : [];
  const flows = changes(oldFlows, newFlows);
  const changedNodes = new Set(nodes.map(n => n.id));
  // A shared downstream step can affect a flow without being owned by that flow.
  function affected(graph: VisualGraph, flow: VisualFlow) {
    const reached = new Set(flow.nodeIds), pending = [flow.entryNodeId, ...flow.nodeIds];
    while (pending.length) {
      const id = pending.pop()!;
      for (const edge of graph.edges.filter(e => e.source === id)) if (!reached.has(edge.target)) { reached.add(edge.target); pending.push(edge.target); }
    }
    return [...changedNodes].some(id => reached.has(id)) || edges.some(e => [e.before, e.after].some(link => link && reached.has(link.source)));
  }
  const flowIds = [...new Set([...oldFlows, ...newFlows].map(f => f.id))].sort();
  const affectedFlowIds = flowIds.filter(id => flows.some(f => f.id === id) || oldFlows.some(f => f.id === id && affected(before, f)) || newFlows.some(f => f.id === id && affected(after, f)));
  const metadata: WorkflowDiff["metadata"] = [];
  if (before.name !== after.name) metadata.push("name");
  if (before.version !== after.version) metadata.push("version");
  return { nodes, edges, flows, affectedFlowIds, unchangedFlowIds: flowIds.filter(id => !affectedFlowIds.includes(id)), metadata, empty: !nodes.length && !edges.length && !flows.length && !metadata.length };
}

export function diffHighlights(diff: WorkflowDiff, side: "before" | "after") {
  const visible = (kind: ChangeKind) => side === "before" ? kind !== "added" : kind !== "removed";
  return {
    nodes: Object.fromEntries(diff.nodes.filter(c => visible(c.kind)).map(c => [c.id, c.kind])),
    edges: Object.fromEntries(diff.edges.filter(c => visible(c.kind)).map(c => [c.id, c.kind])),
  };
}
