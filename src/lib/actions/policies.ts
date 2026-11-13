import { actionCatalog } from "./catalog";

/** Standard business features are available without package/module activation.
 * Only exceptional platform powers belong in the entitlement catalog. */
export const policyCatalog: Record<string, { name: string; description: string; automated: boolean; version: number }> = {
  "business.provision": actionCatalog["business.provision"],
  "prospect.instagram_scan": {
    name: "Lexo Instagram-in e klientit të interesuar",
    description: "Agjenti lexon profilin publik të Instagram-it që klienti jep në bisedë (vetëm të dhëna publike) dhe ia bashkëngjit ftesës për biznesin e ri. Kufiri mujor bosh = 50.",
    automated: true, version: 1,
  },
};
export function isPolicyKey(key: string) {
  return Object.hasOwn(policyCatalog, key);
}
