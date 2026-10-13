import type { VisualGraph, VisualFlow, VisualNode } from "@/lib/workflows/visual/types";
import { getCapability } from "./registry";

/** Existing bounded backstop, shared by AI and manual validation; not a language parser. */
export function unsupportedRequestKeys(text: string): string[] {
  const value = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const keys: string[] = [];
  if (/\binventory\b|\bstok\w*|\b(?:check|track|monitor)\s+(?:the\s+)?stock\b|back.in.stock/.test(value)) keys.push("inventory.check");
  if (/back.in.stock|(?:notify|njoft)\w*[\s\S]*(?:stock|stok|rikthe|gjendje)/.test(value)) keys.push("back_in_stock.notify");
  if (/\bcron\b|\b(?:every (?:day|week|month|hour)|cdo (?:dite|jave|muaj|ore))\b|\b(?:schedule[ds]?|planifik\w*)\s+(?:(?:a|an|the|nje)\s+)?(?:automation|workflow|notification|message|email|job|task|action|automatizim\w*|njoft\w*|mesazh\w*|detyr\w*|veprim\w*)\b/.test(value)) keys.push("schedule.trigger");
  return keys;
}

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
    ...graph.nodes.flatMap(node => unsupportedRequestKeys(`${node.label} ${node.config.prompt ?? ""} ${node.config.fieldKey ?? ""} ${node.config.value ?? ""}`)),
    ...flows.flatMap(flow => unsupportedRequestKeys(flow.label)),
  ])];
  const productIds = [...new Set(flows.flatMap(flow => flow.productIds ?? []))];
  const serviceIds = [...new Set(flows.flatMap(flow => flow.serviceIds ?? []))];
  return { capabilityKeys, productIds, serviceIds,
    modules: [...new Set(["workflows", ...capabilityKeys.flatMap(key => getCapability(key)?.requiredModules ?? []), ...(productIds.length ? ["products"] : []), ...(serviceIds.length ? ["services"] : [])])] };
}
