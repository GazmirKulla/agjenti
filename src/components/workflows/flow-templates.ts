import { nodeLabels, upgradeVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualFlow, VisualFlowKind, VisualGraph, VisualNode, VisualNodeKind } from "@/lib/workflows/visual/types";

export type FlowTemplate = VisualFlowKind | "order_status";
export const flowTemplateLabels: Record<FlowTemplate, string> = {
  information: "Informacion", order: "Porosi", booking: "Rezervim", support: "Staf", custom: "Rrjedhë tjetër", order_status: nodeLabels.order_status,
};

/** Build the actual capability, so its label cannot accidentally disguise a knowledge step. */
export function addFlowTemplate(graph: VisualGraph, template: FlowTemplate, nodeId: string) {
  const definition = upgradeVisualGraph(graph);
  const kind: VisualFlowKind = template === "order_status" ? "information" : template;
  const nodeKind: VisualNodeKind = template === "order_status" ? "order_status" : kind === "order" ? "product" : kind === "booking" ? "booking" : kind === "support" ? "handoff" : "knowledge";
  const label = flowTemplateLabels[template];
  const count = definition.flows.filter(flow => flow.kind === kind && definition.nodes.find(node => node.id === flow.entryNodeId)?.kind === nodeKind).length;
  const flow: VisualFlow = { id: `flow_${nodeId}`, kind, label: `${label}${count ? ` ${count + 1}` : ""}`, entryNodeId: nodeId, nodeIds: [nodeId] };
  const node: VisualNode = { id: nodeId, kind: nodeKind, label, position: { x: 300, y: 200 }, config: {} };
  definition.nodes.push(node);
  if (nodeKind !== "handoff") {
    const endId = `${nodeId}_end`;
    definition.nodes.push({ id: endId, kind: "end", label: "Prit mesazhin tjetër", position: { x: 620, y: 200 }, config: {} });
    definition.edges.push({ id: `edge_${nodeId}`, source: nodeId, target: endId, port: "next" });
  }
  definition.flows.push(flow);
  return { graph: definition, flow };
}
