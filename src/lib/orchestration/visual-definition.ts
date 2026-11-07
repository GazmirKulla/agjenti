import { upgradeVisualGraph, validateVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualVersion, VisualNode, VisualPort } from "@/lib/workflows/visual/types";
import { TransitionError, type Field, type ProcessDefinition, type Step } from "./contracts";
import { validateDefinition, validFieldValue, digest, destinations } from "./definition";
import { expandBooking } from "./booking-definition";
import { parseCollectionPolicy } from "@/lib/runtime/collection-policy";
import { orderFields, finishOrder } from "./order-definition";
import { serviceFields } from "./service-definition";

export class UnsupportedProcessGraph extends Error {
  constructor(readonly nodeIds: string[]) { super("process_graph_adapter_pending"); }
}

/** Project internal domain steps onto the authored node without changing runtime identity. */
export function visualNodeForStep(version: VisualVersion, stepId: string): string {
  if (version.graph.nodes.some(n => n.id === stepId)) return stepId;
  const booking = version.graph.nodes.find(n => n.kind === "booking" && expandBooking(n.id, "projection").steps.some(s => s.id === stepId));
  if (booking) return booking.id;
  const graph = upgradeVisualGraph(version.graph);
  const selectedFlow = graph.flows.find(f => orderFields(f.id).key("select") === stepId);
  if (selectedFlow) return selectedFlow.entryNodeId;
  for (const flow of graph.flows) {
    const order = orderFields(flow.id), service = serviceFields(flow.id);
    if ([order.key("resolve"), service.key("select"), service.key("resolve")].includes(stepId)) return flow.entryNodeId;
    const product = graph.nodes.find(n => n.kind === "product" && order.key(`resolve_${digest(n.id).slice(0, 8)}`) === stepId);
    if (product) return product.id;
  }
  for (const flow of graph.flows) for (const node of graph.nodes.filter(n => n.kind === "end")) {
    if (finishOrder(flow.id, node.id, node.label, [], false).some(s => s.id === stepId)) return node.id;
  }
  return stepId;
}

/** Deterministic compilation of the editor's immutable graph, never a second authored workflow. */
export function compileVisualProcesses(version: VisualVersion): ProcessDefinition[] {
  const checked = validateVisualGraph(version.graph);
  if (!checked.graph) throw new TransitionError("invalid_visual_definition");
  const graph = upgradeVisualGraph(checked.graph);
  // A legacy authored local start/end graph still represents a real, effect-free
  // process. Compile it through the same engine instead of silently losing it.
  if (checked.graph.version === 1 && !graph.flows.length) {
    const start = graph.nodes.find(n => n.kind === "start");
    if (start) graph.flows.push({ id: "root", label: graph.name, kind: "custom", entryNodeId: start.id, nodeIds: graph.nodes.map(n => n.id) });
  }
  const policy = parseCollectionPolicy(version.collectionPolicy);
  return graph.flows.map(flow => {
    const scope = policy?.scopes.find(s => s.versionId === version.id && s.flowId === flow.id);
    const collectionOnly = scope?.mode === "collection_only";
    const reached = new Map<string, VisualNode>();
    const visit = (id: string) => {
      if (reached.has(id)) return;
      const node = graph.nodes.find(n => n.id === id);
      if (!node) throw new TransitionError("invalid_step_destination");
      reached.set(id, node);
      graph.edges.filter(e => e.source === id).forEach(e => visit(e.target));
    };
    visit(flow.entryNodeId);
    const order = flow.kind === "order" || !!flow.productIds?.length || [...reached.values()].some(n => n.kind === "product");
    const service = !!flow.serviceIds?.length && ![...reached.values()].some(n => n.kind === "booking");
    const fields = new Map<string, Field>();
    for (const node of reached.values()) if (node.kind === "collect") {
      if (!node.config.fieldKey) throw new UnsupportedProcessGraph([node.id]);
      const field: Field = { id: node.config.fieldKey, subject: node.config.subject ?? "request", label: node.label,
        type: node.config.fieldType ?? "text", required: node.config.required ?? true };
      const existing = fields.get(field.id);
      if (existing && (existing.subject !== field.subject || existing.type !== field.type || existing.required !== field.required)) throw new TransitionError("conflicting_field_schema");
      fields.set(field.id, existing ?? field);
    }
    const target = (node: VisualNode, port: VisualPort) => {
      const edges = graph.edges.filter(e => e.source === node.id && e.port === port);
      if (edges.length !== 1) throw new TransitionError("invalid_step_destination");
      return edges[0].target;
    };
    const authoredFieldIds = [...fields.keys()];
    const serviceSchema = serviceFields(flow.id);
    if (service) for (const field of serviceSchema.fields) {
      if (fields.has(field.id)) throw new TransitionError("conflicting_field_schema");
      fields.set(field.id, field);
    }
    const orderSchema = orderFields(flow.id, [...fields.values()], collectionOnly ? scope.profileFields : undefined);
    if (order) for (const field of orderSchema.fields) {
      const existing = fields.get(field.id);
      if (existing && existing !== field) throw new TransitionError("conflicting_field_schema");
      fields.set(field.id, field);
    }
    const steps: Step[] = [...reached.values()].flatMap((node): Step | Step[] => {
      switch (node.kind) {
        case "product": {
          const resolve = orderSchema.key(`resolve_${digest(node.id).slice(0, 8)}`);
          return [{ id: node.id, kind: "collect", fieldId: orderSchema.key("productId"), prompt: node.config.prompt || "Which product would you like?", next: resolve },
            { id: resolve, kind: "resolve", fieldIds: [orderSchema.key("productName")], next: target(node, "next") }];
        }
        case "order_status": return { id: node.id, kind: "effect", tool: "orders.status", toolVersion: 1, inputs: {}, next: target(node, "next"), failed: target(node, "next") };
        case "booking": {
          const owner = graph.flows.find(f => f.nodeIds.includes(node.id));
          const collect = collectionOnly || policy?.scopes.some(s => s.versionId === version.id && s.flowId === owner?.id && s.mode === "collection_only");
          const expanded = expandBooking(node.id, target(node, "next"), collect);
          for (const field of expanded.fields) {
            if (fields.has(field.id)) throw new TransitionError("conflicting_field_schema");
            fields.set(field.id, field);
          }
          return expanded.steps;
        }
        case "collect": return { id: node.id, kind: "collect", fieldId: node.config.fieldKey!, prompt: node.config.prompt!, next: target(node, "next") };
        case "confirm": return { id: node.id, kind: "confirm", fieldIds: [...authoredFieldIds, ...(service ? serviceSchema.fields.map(f => f.id) : [])], requiredFieldIds: [],
          label: node.config.prompt!, yes: target(node, "yes"), no: target(node, "no") };
        case "condition": {
          // These are persisted editor operator identifiers, not customer-language matching.
          const predicates = { intent_support: "The customer requests help from a human staff member", intent_order: "The customer requests to place an order", intent_booking: "The customer requests to make a booking" };
          const operator = node.config.condition;
          if (operator === "intent_support" || operator === "intent_order" || operator === "intent_booking") return {
            id: node.id, kind: "semantic_condition", predicate: `${predicates[operator]}. Configured label: ${node.label}`,
            yes: target(node, "yes"), no: target(node, "no"),
          };
          const field = fields.get(node.config.fieldKey ?? "");
          if (!field || (node.config.condition !== "field_present" && node.config.condition !== "field_equals")) throw new UnsupportedProcessGraph([node.id]);
          const value = field.type === "number" ? Number(node.config.value) : node.config.value;
          if (node.config.condition === "field_equals" && (value === undefined || !validFieldValue(field, value))) throw new TransitionError("invalid_condition");
          return { id: node.id, kind: "condition", fieldId: field.id, operator: node.config.condition === "field_present" ? "present" : "equals",
            ...(node.config.condition === "field_equals" ? { value } : {}), yes: target(node, "yes"), no: target(node, "no") };
        }
        case "knowledge": case "start": return { id: node.id, kind: "inform", next: target(node, "next") };
        case "end": return order ? finishOrder(flow.id, node.id, node.config.prompt || node.label, [...fields.values()].filter(f => authoredFieldIds.includes(f.id) || orderSchema.fields.some(o => o.id === f.id)), collectionOnly, scope?.profileFields)
          : { id: node.id, kind: "end", label: node.config.prompt || node.label };
        case "handoff": return { id: node.id, kind: "handoff", label: node.config.prompt || node.label };
        case "action": {
          const owner = graph.flows.find(f => f.nodeIds.includes(node.id));
          if (collectionOnly || policy?.scopes.some(s => s.versionId === version.id && s.flowId === owner?.id && s.mode === "collection_only"))
            return { id: node.id, kind: "end", label: "The request details were collected. The configured business action was not executed in collection-only mode." };
          const binding = node.config.action;
          if (!binding) throw new TransitionError("invalid_effect_definition");
          return { id: node.id, kind: "effect", tool: binding.actionKey, toolVersion: binding.actionVersion, inputs: binding.inputs, next: target(node, "yes"), failed: target(node, "no") };
        }
        default: throw new UnsupportedProcessGraph([node.id]);
      }
    });
    let entry = flow.entryNodeId;
    if (service) {
      entry = serviceSchema.key("select");
      const resolve = serviceSchema.key("resolve");
      steps.unshift({ id: entry, kind: "collect", fieldId: serviceSchema.key("id"), prompt: "Which service is this request for?", next: resolve },
        { id: resolve, kind: "resolve", fieldIds: [serviceSchema.key("name")], next: flow.entryNodeId });
    }
    if (order && ![...reached.values()].some(n => n.kind === "product")) {
      entry = orderSchema.key("select");
      steps.unshift({ id: entry, kind: "collect", fieldId: orderSchema.key("productId"), prompt: "Which product is this request for?", next: flow.entryNodeId });
    }
    const reachable = new Set<string>();
    const walk = (id: string) => { if (reachable.has(id)) return; reachable.add(id); const step = steps.find(s => s.id === id); if (step) destinations(step).forEach(walk); };
    walk(entry);
    return validateDefinition({ id: flow.id, versionId: version.id, businessId: version.businessId, name: flow.label,
      ...(policy ? { policyKey: digest(policy) } : {}),
      ...(collectionOnly ? { collection: { domain: scope.domain, revision: policy!.revision, profileFields: scope.profileFields } } : {}),
      purpose: flow.purpose || flow.label, offerPolicy: flow.offerPolicy ?? "when_relevant", entry, fields: [...fields.values()], steps: steps.filter(s => reachable.has(s.id)) });
  });
}
