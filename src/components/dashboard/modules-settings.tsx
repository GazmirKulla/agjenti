import { moduleRegistry, toggleableModules } from "@/lib/dashboard/modules/registry";
import type { DashboardProfile, ModuleId } from "@/lib/dashboard/modules/types";
import { moduleDetails } from "@/components/dashboard/module-description";
import { ModulesManager, type ModuleGroup } from "./modules-manager";

/** Names as the menu shows them; the business's own name for its items wins. */
const menuLabels: Partial<Record<ModuleId, string>> = {
  activity: "Aktiviteti", reports: "Raportet", services: "Shërbimet", orders: "Porositë", bookings: "Rezervimet",
  calendar: "Kalendari", catalogs: "Katalogët", leads: "Leads", customers: "Klientët", knowledge: "Njohuritë", workflows: "Workflow",
};
const groups: { title: string; description: string; ids: ModuleId[] }[] = [
  { title: "Kryesore", description: "Në krye të menusë.", ids: ["activity", "reports", "customers", "leads"] },
  { title: "Oferta", description: "Te Menaxhimi: çfarë shet ose ofron biznesi.", ids: ["products", "services", "catalogs"] },
  { title: "Operacionet", description: "Te Menaxhimi: porositë dhe takimet.", ids: ["orders", "bookings", "calendar"] },
  { title: "Agjenti", description: "Te Agjenti i klientëve: çfarë di dhe si punon.", ids: ["knowledge", "workflows"] },
];

/** One page for the panel's sections: what each does, whether it shows in the
 * menu, and a way to open it. Sections the plan does not include stay visible, off. */
export function ModulesSettingsPanel({ slug, profile, allowed, itemsLabel, provisioning }: {
  slug: string; profile: DashboardProfile; allowed: ModuleId[]; itemsLabel: string; provisioning: boolean;
}) {
  const permitted = new Set(allowed);
  const listed = new Set(groups.flatMap((group) => group.ids));
  const extra = toggleableModules.filter((id) => !listed.has(id));
  const data: ModuleGroup[] = [...groups, ...(extra.length ? [{ title: "Të tjera", description: "", ids: extra }] : [])].map((group) => ({
    title: group.title, description: group.description,
    modules: group.ids.filter((id) => toggleableModules.includes(id)).map((id) => ({
      id, path: moduleRegistry[id].path,
      label: id === "products" ? itemsLabel : menuLabels[id] ?? moduleRegistry[id].label,
      summary: moduleRegistry[id].description, details: moduleDetails[id] ?? null,
      allowed: permitted.has(id), shown: profile.navigationItems.includes(id),
    })),
  }));
  return <ModulesManager slug={slug} groups={data} provisioning={provisioning} />;
}
