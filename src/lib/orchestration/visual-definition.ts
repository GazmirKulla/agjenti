import { upgradeVisualGraph, validateVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualVersion, VisualNode, VisualPort } from "@/lib/workflows/visual/types";
import { TransitionError, type Field, type ProcessDefinition, type Step } from "./contracts";
import { validateDefinition, validFieldValue } from "./definition";

export class UnsupportedProcessGraph extends Error {
  constructor(readonly nodeIds: string[]) { super("process_graph_adapter_pending"); }
}

/** Deterministic compilation of the editor's immutable graph, never a second authored workflow. */
export function compileVisualProcesses(version: VisualVersion): ProcessDefinition[] {
  const checked = validateVisualGraph(version.graph);
  if (!checked.graph) throw new TransitionError("invalid_visual_definition");
  const graph = upgradeVisualGraph(checked.graph);
  const unsupported = graph.nodes.filter(n => n.kind === "product" || n.kind === "booking" || n.kind === "order_status" || n.config.fieldType === "photo");
  if (unsupported.length) throw new UnsupportedProcessGraph(unsupported.map(n => n.id));
  return graph.flows.map(flow => {
    const reached = new Map<string, VisualNode>();
    const visit = (id: string) => {
      if (reached.has(id)) return;
      const node = graph.nodes.find(n => n.id === id);
      if (!node) throw new TransitionError("invalid_step_destination");
      reached.set(id, node);
      graph.edges.filter(e => e.source === id).forEach(e => visit(e.target));
    };
    visit(flow.entryNodeId);
    const fields = new Map<string, Field>();
    for (const node of reached.values()) if (node.kind === "collect") {
      if (!node.config.fieldKey || node.config.fieldType === "photo") throw new UnsupportedProcessGraph([node.id]);
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
    const steps: Step[] = [...reached.values()].map(node => {
      switch (node.kind) {
        case "collect": return { id: node.id, kind: "collect", fieldId: node.config.fieldKey!, prompt: node.config.prompt!, next: target(node, "next") };
        case "confirm": return { id: node.id, kind: "confirm", fieldIds: [...fields.keys()], requiredFieldIds: [],
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
        case "end": case "handoff": return { id: node.id, kind: node.kind, label: node.config.prompt || node.label };
        case "action": {
          const binding = node.config.action;
          if (!binding) throw new TransitionError("invalid_effect_definition");
          return { id: node.id, kind: "effect", tool: binding.actionKey, toolVersion: binding.actionVersion, inputs: binding.inputs, next: target(node, "yes"), failed: target(node, "no") };
        }
        default: throw new UnsupportedProcessGraph([node.id]);
      }
    });
    return validateDefinition({ id: flow.id, versionId: version.id, businessId: version.businessId, name: flow.label,
      purpose: flow.purpose || flow.label, offerPolicy: flow.offerPolicy ?? "when_relevant", entry: flow.entryNodeId, fields: [...fields.values()], steps });
  });
}
