import { TransitionError, type Instance, type ProcessDefinition } from "./contracts";
import type { ProcessVersion } from "./linear-definition";
import { composeProductCollection } from "./product-composition";
import { orderFields } from "./order-definition";
import { digest } from "./definition";

/** Current bindings are loaded by the server; accepted product selection pins their version. */
export function productDependencies(versions: ReadonlyMap<string, ProcessVersion>, current: ProcessVersion[]) {
  const cache = new Map<string, ProcessDefinition>();
  return {
    bindDependencies(instance: Instance, eventId: string) {
      const owner = versions.get(instance.versionId);
      const productId = instance.facts[orderFields(instance.definitionId).key("productId")]?.value;
      if (typeof productId !== "string" || instance.productWorkflow?.productId === productId) return;
      const matches = current.filter(v => v.linear?.productIds.includes(productId));
      if (matches.length > 1) throw new TransitionError("ambiguous_product_workflow");
      const selected = matches[0];
      if (owner?.linear && selected?.linear?.workflowId !== owner.linear.workflowId) throw new TransitionError("product_outside_workflow");
      // A corrected product must not inherit the previous product's option values.
      const previous = instance.productWorkflow?.versionId ? versions.get(instance.productWorkflow.versionId) : undefined;
      for (const step of previous?.linear?.steps ?? []) if (step.kind !== "customer" && step.kind !== "confirm") {
        if (instance.facts[step.fieldKey ?? step.key]?.eventId !== eventId) delete instance.facts[step.fieldKey ?? step.key];
        if (instance.skippedFields) delete instance.skippedFields[step.fieldKey ?? step.key];
      }
      instance.productWorkflow = { productId, workflowId: selected?.linear?.workflowId ?? null, versionId: owner?.linear ? owner.id : selected?.id ?? null };
    },
    resolveDefinition(base: ProcessDefinition, instance: Instance) {
      const pin = instance.productWorkflow;
      if (!pin?.versionId) return base;
      if (instance.facts[orderFields(base.id).key("productId")]?.value !== pin.productId) throw new TransitionError("product_dependency_mismatch");
      const version = versions.get(pin.versionId);
      if (!version?.linear || version.linear.workflowId !== pin.workflowId || version.businessId !== base.businessId) throw new TransitionError("product_dependency_unavailable");
      if (versions.get(base.versionId)?.linear) return base;
      const key = digest([base, pin.versionId]);
      let compiled = cache.get(key);
      if (!compiled) { compiled = composeProductCollection(base, version); cache.set(key, compiled); }
      return compiled;
    },
  };
}
