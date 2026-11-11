import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("./modules-manager.css", () => ({}));
vi.mock("@/lib/dashboard/modules/actions", () => ({ saveModules: vi.fn() }));
import { ModulesSettingsPanel } from "./modules-settings";
import type { DashboardProfile } from "@/lib/dashboard/modules/types";

it("groups the sections as in the menu, with the menu's names, links and plan locks", () => {
  const profile = { navigationItems: ["products", "orders", "knowledge"] } as unknown as DashboardProfile;
  const html = renderToStaticMarkup(ModulesSettingsPanel({
    slug: "zana", profile, allowed: ["products", "orders", "knowledge", "reports"], itemsLabel: "Listimet", provisioning: false,
  }));
  for (const title of ["Kryesore", "Oferta", "Operacionet", "Agjenti"]) expect(html).toContain(title);
  expect(html).toContain("Listimet");
  expect(html).toContain("Porositë");
  expect(html).toContain("Njohuritë");
  expect(html).toContain('href="/b/zana/orders"');
  // Not in the plan: shown, switched off and explained.
  expect(html).toContain("Nuk përfshihet në paketën tënde");
  expect(html).not.toContain("Krijimi i bizneseve për klientë");
});
