import { moduleDependencies, moduleRegistry } from "./registry";
import { operationCatalog } from "@/lib/actions/operations/catalog";
import type { ModuleId } from "./types";

/** The menu module where a saved assistant change appears. Presentation only:
 * hiding a module never limits what the assistant may do. */
export function moduleForAction(action: string, operationKey?: string): ModuleId | null {
  // Reviewed operations name their module in the catalog. Removals do not add
  // anything worth showing, so they never prompt.
  if (action === "operation") {
    if (!operationKey || !Object.hasOwn(operationCatalog, operationKey)) return null;
    if (/\.(delete|remove|archive|pause|resume|sync|reconcile|verify)$/.test(operationKey)) return null;
    return operationCatalog[operationKey as keyof typeof operationCatalog].module as ModuleId;
  }
  if (/^product_/.test(action)) return "products";
  if (/^service_/.test(action)) return "services";
  if (/^knowledge_/.test(action)) return "knowledge";
  if (/^booking_/.test(action)) return "bookings";
  if (/^(workflow_(draft|restore|publish|enable|disable)|linear_(draft|link|publish)|orderflow_(create|update|assign))$/.test(action)) return "workflows";
  return null;
}

/** A module plus the modules it needs in order to make sense in the menu. */
export function withRequiredModules(id: ModuleId): ModuleId[] {
  const out = new Set<ModuleId>();
  const visit = (m: ModuleId) => {
    if (out.has(m)) return;
    out.add(m);
    const rule = moduleDependencies[m];
    for (const dep of rule.requires ?? []) visit(dep);
    if (rule.requiresAny?.length) visit(rule.requiresAny[0]);
  };
  visit(id);
  return [...out];
}

/** Offer to show the module a change was saved in, when the owner hid it. */
export function hiddenModuleHint(action: string, hidden: readonly string[], operationKey?: string) {
  const id = moduleForAction(action, operationKey);
  if (!id || !hidden.includes(id) || moduleRegistry[id].preview) return null;
  return { id, label: moduleRegistry[id].label };
}
