import type { VisualGraphV2 } from "@/lib/workflows/visual/types";

/** Include legacy routing steps that lead exclusively into this flow, without
 * pulling shared message routers or another process into its diagram. */
export function flowVisibleNodeIds(graph: VisualGraphV2, flowId: string): Set<string> {
  const flow = graph.flows.find(flow => flow.id === flowId);
  if (!flow) return new Set();
  const owner = new Map(graph.flows.flatMap(flow => flow.nodeIds.map(id => [id, flow.id] as const)));
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const destinations = new Map(graph.nodes.map(node => [node.id, new Set<string>(owner.has(node.id) ? [owner.get(node.id)!] : [])]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (owner.has(edge.source) || nodes.get(edge.source)?.kind === "start") continue;
      const source = destinations.get(edge.source);
      if (!source) continue;
      for (const target of destinations.get(edge.target) ?? []) {
        if (!source.has(target)) { source.add(target); changed = true; }
      }
    }
  }
  const visible = new Set(flow.nodeIds);
  for (const node of graph.nodes) {
    if (owner.has(node.id) || ["start", "end"].includes(node.kind)) continue;
    const targets = destinations.get(node.id)!;
    if (targets.size === 1 && targets.has(flowId)) visible.add(node.id);
  }
  // Include ungrouped downstream steps and shared endings, but stop at another flow.
  const visit = (id: string) => {
    for (const edge of graph.edges.filter(edge => edge.source === id)) {
      if (visible.has(edge.target) || (owner.has(edge.target) && owner.get(edge.target) !== flowId)) continue;
      visible.add(edge.target); visit(edge.target);
    }
  };
  for (const id of [...visible]) visit(id);
  return visible;
}
