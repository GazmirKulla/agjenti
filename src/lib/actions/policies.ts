import { actionCatalog } from "./catalog";

/** Standard business features are available without package/module activation.
 * Only exceptional platform powers belong in the entitlement catalog. */
export const policyCatalog: Record<string, { name: string; description: string; automated: boolean; version: number }> = {
  "business.provision": actionCatalog["business.provision"],
};
export function isPolicyKey(key: string) {
  return Object.hasOwn(policyCatalog, key);
}
