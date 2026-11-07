import { TransitionError, type ProcessDefinition, type Step } from "./contracts";
import { compileLinearProcess, type ProcessVersion } from "./linear-definition";
import { digest, validateDefinition } from "./definition";
import { orderFields } from "./order-definition";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import { compileVisualProcesses, visualNodeForStep } from "./visual-definition";

export function productStepSource(parent: VisualVersion, child: ProcessVersion, stepId: string): { nodeId: string; stepKey: string | null } | undefined {
  if (!child.linear) return;
  for (const definition of compileVisualProcesses(parent)) for (const selector of definition.steps) {
    if (selector.kind !== "collect" || selector.fieldId !== orderFields(definition.id).key("productId")) continue;
    const prefix = `product_${digest([child.id, selector.id]).slice(0, 16)}_`;
    if (stepId === `${prefix}declined`) return { nodeId: visualNodeForStep(parent, selector.id), stepKey: null };
    for (const step of child.linear.steps) {
      const id = `${prefix}linear_${digest(step.key).slice(0, 20)}`;
      if (stepId === id || step.kind === "customer" && [1, 2, 3].some(index => stepId === `${id}_${index}`))
        return { nodeId: visualNodeForStep(parent, selector.id), stepKey: step.key };
    }
  }
}

/** Inline only collection steps. The parent owns the single commercial review/effect. */
export function composeProductCollection(base: ProcessDefinition, version: ProcessVersion): ProcessDefinition {
  if (!version.linear || version.businessId !== base.businessId) throw new TransitionError("definition_scope_mismatch");
  const child = compileLinearProcess(version), childProduct = orderFields(child.id).key("productId");
  const fields = child.fields.filter(f => f.source !== "server" && f.id !== childProduct
    && (!base.collection || !["customer_name", "customer_phone", "customer_city", "customer_address", "customer_email"].includes(f.id)
      || base.collection.profileFields.some(name => f.id === `customer_${name}`)));
  const definition = structuredClone(base);
  for (const field of fields) {
    const existing = definition.fields.find(f => f.id === field.id);
    if (existing) {
      if (existing.source === "server" || existing.type !== field.type || digest(existing.options ?? []) !== digest(field.options ?? []))
        throw new TransitionError("conflicting_product_field_schema");
      existing.required ||= field.required;
    } else definition.fields.push(field);
  }
  const fragment = child.steps.filter(s => s.id !== "product" && s.id !== "resolve_product" && (s.id === "declined" || child.steps.some(c =>
    c.id === "resolve_product" && c.kind === "resolve" && c.next === s.id) || version.linear!.steps.some(authored => {
      const id = `linear_${digest(authored.key).slice(0, 20)}`;
      return s.id === id || authored.kind === "customer" && [1, 2, 3].some(index => s.id === `${id}_${index}`);
    })));
  const entry = child.steps.find(s => s.id === "resolve_product");
  if (entry?.kind !== "resolve") throw new TransitionError("invalid_product_collection");
  const productField = orderFields(base.id).key("productId");
  const selectors = definition.steps.filter(s => s.kind === "collect" && s.fieldId === productField);
  for (const selector of selectors) {
    if (selector.kind !== "collect") continue;
    const next = definition.steps.find(s => s.id === selector.next);
    const anchor = next?.kind === "resolve" ? next : selector;
    const destination = anchor.next;
    const prefix = `product_${digest([version.id, selector.id]).slice(0, 16)}_`;
    const mapId = (id: string): string => {
      const skipped = fragment.find(s => s.id === id && s.kind === "collect" && !fields.some(f => f.id === s.fieldId));
      return skipped?.kind === "collect" ? mapId(skipped.next) : id === "finish" ? destination : `${prefix}${id}`;
    };
    anchor.next = mapId(entry.next);
    definition.steps.push(...fragment.filter(s => s.kind !== "collect" || fields.some(f => f.id === s.fieldId)).map((step): Step => {
      if (step.kind === "collect") return { ...step, id: mapId(step.id), next: mapId(step.next) };
      if (step.kind === "confirm") return { ...step, id: mapId(step.id), fieldIds: fields.map(f => f.id), yes: mapId(step.yes), no: mapId(step.no) };
      if (step.kind === "end") return { ...step, id: mapId(step.id) };
      throw new TransitionError("invalid_product_collection");
    }));
  }
  for (const step of definition.steps) if (step.kind === "confirm" && step.fieldIds.includes(productField)) {
    step.fieldIds = [...new Set([...step.fieldIds, ...fields.map(f => f.id)])];
    step.requiredFieldIds = [...new Set([...(step.requiredFieldIds ?? step.fieldIds), ...fields.filter(f => f.required).map(f => f.id)])];
  }
  return validateDefinition(definition);
}
