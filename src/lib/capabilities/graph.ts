import type { VisualGraph, VisualFlow, VisualNode } from "@/lib/workflows/visual/types";
import { getCapability } from "./registry";

export function nodeCapabilityKeys(node: VisualNode): string[] {
  if (node.kind === "action" && node.config.action) return [node.config.action.actionKey];
  return ({ knowledge: ["knowledge.answer"], product: ["product.search", "order.prepare"],
    booking: ["booking.availability.read", "booking.create"], order_status: ["order.status.read"], handoff: ["staff.handoff"] } as Record<string, string[]>)[node.kind] ?? [];
}

export function flowCapabilityKeys(flow: VisualFlow): string[] {
  // A bound custom product flow can prepare an order without a product node.
  return [...(flow.productIds?.length ? ["product.search"] : []),
    ...(flow.kind === "order" || flow.kind === "custom" && flow.productIds?.length ? ["order.prepare"] : [])];
}

export function graphRequirements(graph: VisualGraph) {
  const flows = graph.version === 2 ? graph.flows : [];
  const capabilityKeys = [...new Set([...graph.nodes.flatMap(nodeCapabilityKeys), ...flows.flatMap(flowCapabilityKeys),
  ])];
  const productIds = [...new Set(flows.flatMap(flow => flow.productIds ?? []))];
  const serviceIds = [...new Set(flows.flatMap(flow => flow.serviceIds ?? []))];
  return { capabilityKeys, productIds, serviceIds,
    modules: [...new Set(["workflows", ...capabilityKeys.flatMap(key => getCapability(key)?.requiredModules ?? []), ...(productIds.length ? ["products"] : []), ...(serviceIds.length ? ["services"] : [])])] };
}
