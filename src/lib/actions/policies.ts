import { actionCatalog, isActionKey } from "./catalog";
import { moduleRegistry, toggleableModules } from "@/lib/dashboard/modules/registry";

/** Module entitlements share the existing action policy tables, not a second ACL. */
export const policyCatalog: Record<string, { name: string; description: string; automated: boolean; version: number }> = {
  ...Object.fromEntries(toggleableModules.map(id => [`module.${id}`, {
    name: moduleRegistry[id].label,
    description: moduleRegistry[id].description,
    automated: false,
    version: 1,
  }])),
  ...actionCatalog,
};
export function isPolicyKey(key: string) {
  return isActionKey(key) || toggleableModules.some(id => key === `module.${id}`);
}
