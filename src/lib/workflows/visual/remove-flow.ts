import { upgradeVisualGraph } from "./model";
import type { VisualGraph } from "./types";

/** Remove a draft process and its exclusive downstream steps, preserving shared steps. */
export function removeVisualFlow(graph: VisualGraph, flowId: string) {
  const next = upgradeVisualGraph(graph);
  const flow = next.flows.find(item => item.id === flowId);
  if (!flow) return { error: "Kjo rrjedhë nuk gjendet më në draft." };
  const owned = new Set(flow.nodeIds);
  const otherOwned = new Set(next.flows.filter(item => item.id !== flowId).flatMap(item => item.nodeIds));
  const nodes = new Map(next.nodes.map(node => [node.id, node]));
  const removable = new Set<string>();
  function visit(id: string) {
    if (removable.has(id) || otherOwned.has(id) || !nodes.has(id) || nodes.get(id)?.kind === "start") return;
    removable.add(id);
    next.edges.filter(edge => edge.source === id).forEach(edge => visit(edge.target));
  }
  flow.nodeIds.forEach(visit);
  // A shared ending or ungrouped step must survive, as must its downstream chain.
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of next.edges) {
      if (!removable.has(edge.source) && removable.has(edge.target) && !owned.has(edge.target)) {
        removable.delete(edge.target);
        changed = true;
      }
    }
  }
  const incoming = next.edges.filter(edge => !removable.has(edge.source) && removable.has(edge.target));
  if (incoming.length) {
    const labels = [...new Set(incoming.map(edge => nodes.get(edge.source)?.label ?? edge.source))];
    return { error: `Kjo rrjedhë përdoret nga hapat: ${labels.join(", ")}. Ndrysho lidhjet e tyre përpara fshirjes.` };
  }
  next.flows = next.flows.filter(item => item.id !== flowId);
  next.nodes = next.nodes.filter(node => !removable.has(node.id));
  next.edges = next.edges.filter(edge => !removable.has(edge.source) && !removable.has(edge.target));
  return { graph: next, removedNodeCount: removable.size, productCount: flow.productIds?.length ?? 0, serviceCount: flow.serviceIds?.length ?? 0 };
}
