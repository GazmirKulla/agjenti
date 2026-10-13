import type { VisualGraph, VisualRunState } from "./types";

/** Only the current flow owns custom facts. V1 has one unnamed workflow. */
function ownedNodes(graph: VisualGraph, cursor?: Pick<VisualRunState, "nodeId" | "binding">) {
  if (graph.version === 1) return graph.nodes;
  const flow = graph.flows.find(flow => cursor?.binding ? flow.id === cursor.binding.flowId : flow.nodeIds?.includes(cursor?.nodeId ?? ""));
  return graph.nodes.filter(node => flow?.nodeIds.includes(node.id));
}
export function ownedCollectNodes(graph: VisualGraph, cursor?: Pick<VisualRunState, "nodeId" | "binding">) {
  return ownedNodes(graph, cursor).filter(node => node.kind === "collect");
}
/** Include configured condition/action inputs even if collected before this flow. */
export function confirmationFactKeys(graph: VisualGraph, cursor: VisualRunState) {
  return [...new Set(ownedNodes(graph, cursor).flatMap(node => [
    ...(node.config.fieldKey ? [node.config.fieldKey] : []),
    ...Object.values(node.config.action?.inputs ?? {}),
  ]))].sort();
}
