import type { VisualVersion, VisualNode } from "@/lib/workflows/visual/types";
import type { WorkflowStepDef } from "@/lib/workflows/engine";
import { parseLinearDefinition } from "@/lib/workflows/linear";
import type { Field, ProcessDefinition, Step } from "./contracts";
import { TransitionError } from "./contracts";
import { digest, validateDefinition } from "./definition";
import { finishOrder, orderFields } from "./order-definition";
export type ProcessVersion = VisualVersion & { linear?: { workflowId: string; steps: WorkflowStepDef[]; productIds: string[] } };
export function linearProcessVersion(input: { id: string; businessId: string; workflowId: string; name: string; steps: WorkflowStepDef[]; productIds: string[] }): ProcessVersion {
  const parsed = parseLinearDefinition({ name: input.name, steps: input.steps });
  const flowId = `linear_${input.workflowId}`;
  const node: VisualNode = { id: "product", kind: "product", label: parsed.name, config: {}, position: { x: 0, y: 0 } };
  return { id: input.id, businessId: input.businessId, createdAt: "", linear: { workflowId: input.workflowId, steps: parsed.steps, productIds: input.productIds },
    graph: { version: 2, name: parsed.name, flows: [{ id: flowId, label: parsed.name, kind: "order", entryNodeId: "product", nodeIds: ["product"], productIds: input.productIds }], nodes: [node], edges: [] } };
}
export function compileLinearProcess(version: ProcessVersion): ProcessDefinition {
  const linear = version.linear;
  if (!linear) throw new TransitionError("linear_definition_unavailable");
  const definitionId = `linear_${linear.workflowId}`, { key } = orderFields(definitionId);
  const fields = new Map<string, Field>();
  const nodeId = (s: WorkflowStepDef) => `linear_${digest(s.key).slice(0, 20)}`;
  for (const s of linear.steps) if (s.kind !== "customer" && s.kind !== "confirm") {
    const id = s.fieldKey ?? s.key;
    const field: Field = { id, subject: "order", label: s.label ?? s.key, type: s.kind === "photo" ? "photo" : s.kind === "choice" && s.options?.length ? "choice" : s.fieldType ?? "text",
      required: s.required !== false, ...(s.options?.length ? { options: s.options } : {}) };
    if (fields.has(id)) throw new TransitionError("conflicting_field_schema"); fields.set(id, field);
  }
  const schema = orderFields(definitionId, [...fields.values()]);
  for (const field of schema.fields) { if (fields.has(field.id) && fields.get(field.id) !== field) throw new TransitionError("conflicting_field_schema"); fields.set(field.id, field); }
  const steps: Step[] = [{ id: "product", kind: "collect", fieldId: key("productId"), prompt: "Which product would you like?", next: "resolve_product" },
    { id: "resolve_product", kind: "resolve", fieldIds: [key("productName")], next: nodeId(linear.steps[0]) }];
  linear.steps.forEach((s, index) => {
    const id = nodeId(s), next = index + 1 < linear.steps.length ? nodeId(linear.steps[index + 1]) : "finish";
    if (s.kind === "customer") schema.customer.forEach((f, i) => steps.push({ id: i === 0 ? id : `${id}_${i}`, kind: "collect", fieldId: f.id, prompt: f.label, next: i + 1 < schema.customer.length ? `${id}_${i + 1}` : next }));
    else if (s.kind === "confirm") steps.push({ id, kind: "confirm", fieldIds: [...fields.values()].filter(f => f.source !== "server").map(f => f.id), requiredFieldIds: [], label: s.prompt || s.label || "Review these details", yes: next, no: "declined" });
    else steps.push({ id, kind: "collect", fieldId: s.fieldKey ?? s.key, prompt: s.prompt || s.label || s.key, next });
  });
  steps.push(...finishOrder(definitionId, "finish", "The order request is ready. Explain the verified submission outcome.", [...fields.values()]));
  if (linear.steps.some(s => s.kind === "confirm")) steps.push({ id: "declined", kind: "end", label: "The request was declined; no order was created." });
  return validateDefinition({ id: definitionId, versionId: version.id, businessId: version.businessId, name: version.graph.name,
    purpose: `Order products bound to workflow ${linear.workflowId}; preserve its configured options and delivery fields. Product IDs: ${linear.productIds.join(", ")}`,
    offerPolicy: "on_request", entry: "product", fields: [...fields.values()], steps });
}
