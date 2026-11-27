import { expect, it } from "vitest";
import { businessWorkspaceGroups, organizeWorkspace, workspaceSection, activeWorkspaceLink } from "./workspace";
import { buildAdminNavigation, buildNavigationItems } from "./builder";
import { legacyDashboardProfile } from "../profile/legacy";
import { moduleRegistry, navigationOrder } from "../modules/registry";

const allItems = navigationOrder.map(id => ({ ...moduleRegistry[id] }));
const navigation = organizeWorkspace(allItems);

it("retains a reachable destination and search result for every existing module", () => {
  const destinations = [...navigation.primary, ...navigation.agent, ...navigation.settings, ...navigation.integrations, ...navigation.business];
  // Sources are reached from Knowledge, not from the menu.
  for (const item of allItems.filter(item => item.id !== "sources")) {
    expect(destinations.some(destination => destination.path === item.path), item.id).toBe(true);
    expect(navigation.search.some(destination => destination.path === item.path && destination.label === item.label), item.id).toBe(true);
  }
  expect(navigation.primary.map(item => item.label)).toEqual(["Kreu", "Bisedat", "Produkte", "Shërbime", "Porosi", "Leads", "Klientë", "Agjenti i klientëve", "Aktiviteti", "Raportet", "Kanalet", "Cilësimet"]);
});

it("groups workflow and its deep links under the agent while keeping the original URL", () => {
  expect(navigation.agent.find(item => item.id === "workflows")?.path).toBe("workflows");
  expect(workspaceSection("/b/shop/workflows", "/b/shop", navigation)).toBe("agent");
  expect(workspaceSection("/b/shop/agents/memory", "/b/shop", navigation)).toBe("agent");
  expect(activeWorkspaceLink("/b/shop/agents/memory", "/b/shop", navigation.agent)).toBe("agents");
  expect(activeWorkspaceLink("/b/shop/agents/test", "/b/shop", navigation.agent)).toBe("agents/test");
});

it("organizes the agent by the owner's topics, with inner pages kept in their topic", () => {
  expect(navigation.agent.map(item => [item.path, item.label])).toEqual([
    ["agents/business", "Biznesi"], ["knowledge", "Oferta"], ["agents/orders", "Kur klienti porosit"], ["agents/bookings", "Kur klienti rezervon"], ["agents", "Si flet dhe kur thërret stafin"],
    ["agents/test", "Prova dhe kontrolli"], ["workflows", moduleRegistry.workflows.label]]);
  // Only the topics the business uses.
  const servicesOnly = organizeWorkspace(allItems.filter(item => ["agents", "knowledge", "services"].includes(item.id)));
  expect(servicesOnly.agent.map(item => item.label)).toEqual(["Biznesi", "Oferta", "Kur klienti rezervon", "Si flet dhe kur thërret stafin", "Prova dhe kontrolli"]);
  const neither = organizeWorkspace(allItems.filter(item => ["agents", "knowledge"].includes(item.id)));
  expect(neither.agent.map(item => item.label)).toEqual(["Biznesi", "Oferta", "Si flet dhe kur thërret stafin", "Prova dhe kontrolli"]);
  expect(activeWorkspaceLink("/b/shop/agents/process", "/b/shop", neither.agent)).toBe("agents");
  expect(activeWorkspaceLink("/b/shop/agents/bookings", "/b/shop", navigation.agent)).toBe("agents/bookings");
  expect(activeWorkspaceLink("/b/shop/agents/training", "/b/shop", navigation.agent)).toBe("knowledge");
  expect(activeWorkspaceLink("/b/shop/sources", "/b/shop", navigation.agent)).toBe("knowledge");
  expect(workspaceSection("/b/shop/sources", "/b/shop", navigation)).toBe("agent");
  expect(activeWorkspaceLink("/b/shop/agents/process", "/b/shop", navigation.agent)).toBe("agents");
  expect(activeWorkspaceLink("/b/shop/agents/business", "/b/shop", navigation.agent)).toBe("agents/business");
  for (const path of ["agents/training", "agents/memory", "agents/process"]) expect(navigation.search.some(item => item.path === path), path).toBe(true);
});

it("keeps operational details, channel settings, onboarding and accounts reachable", () => {
  expect(workspaceSection("/b/shop/products/record", "/b/shop", navigation)).toBe("products");
  expect(workspaceSection("/b/shop/inbox/record/customer", "/b/shop", navigation)).toBe("conversations");
  for (const path of ["setup"]) expect(workspaceSection(`/b/shop/${path}`, "/b/shop", navigation)).toBe("settings");
  expect(navigation.settings.some(item => item.path === "account")).toBe(false);
  expect(workspaceSection("/b/shop/account", "/b/shop", navigation)).toBeUndefined();
  expect(workspaceSection("/b/shop/activity", "/b/shop", navigation)).toBe("activity");
  expect(workspaceSection("/b/shop/reports", "/b/shop", navigation)).toBe("reports");
  expect(workspaceSection("/b/other/workflows", "/b/shop", navigation)).toBeUndefined();
  expect(workspaceSection("/b/shop/workflows-other", "/b/shop", navigation)).toBeUndefined();
});

it("does not expose optional modules omitted by the business profile", () => {
  const limited = organizeWorkspace(buildNavigationItems({ ...legacyDashboardProfile, navigationItems: ["dashboard", "inbox", "agents", "services", "settings"] }));
  expect(limited.primary.map(item => item.id)).toContain("services");
  expect(limited.business.map(item => item.id)).toEqual([]);
  expect(limited.search.some(item => item.path === "products" || item.path === "workflows")).toBe(false);
  expect(limited.agent.map(item => item.path)).toEqual(["agents/business", "agents/bookings", "agents", "agents/test"]);
});

it("leaves administrator navigation independent of the business grouping", () => {
  expect(buildAdminNavigation().map(item => item.path)).toEqual(["", "businesses", "users", "usage", "health", "product-types", "conversations", "pricing", "actions", "chat-lab", "prompts", "flows", "onboarding", "settings"]);
});

it("keeps manual offers, knowledge, channels, behavior and operations in task groups without duplicates", () => {
  const groups = businessWorkspaceGroups(navigation);
  expect(groups.map(group => group.id)).toEqual(["offer", "knowledge", "channels", "behavior", "operations"]);
  const paths = groups.flatMap(group => group.items.map(item => item.path));
  expect(new Set(paths).size).toBe(paths.length);
  for (const path of ["products", "services", "catalogs", "knowledge", "integrations", "agents", "agents/test", "orders", "bookings", "leads"])
    expect(paths).toContain(path);
  expect(paths).not.toContain("calendar"); // A tab of Rezervimet; /calendar redirects there.
  expect(paths).not.toContain("workflows"); // Still reachable in Advanced, never removed.
  const limited = organizeWorkspace(allItems.filter(item => ["dashboard", "inbox", "services"].includes(item.id)));
  expect(businessWorkspaceGroups(limited).flatMap(group => group.items.map(item => item.path))).toEqual(["services"]);
});


it("keeps Instagram and WhatsApp in the one Kanalet section, old pages included", () => {
  for (const path of ["integrations", "instagram", "whatsapp"]) {
    expect(workspaceSection(`/b/shop/${path}`, "/b/shop", navigation)).toBe("integrations");
    expect(navigation.settings.some(item => item.path === path)).toBe(false);
    expect(navigation.business.some(item => item.path === path)).toBe(false);
  }
  expect(navigation.primary.find(item => item.id === "integrations")).toMatchObject({ path: "integrations", label: "Kanalet" });
  const noChannels = organizeWorkspace(allItems.filter(item => item.id !== "channels"));
  expect(noChannels.primary.some(item => item.id === "integrations")).toBe(false);
});

it("keeps standalone business modules out of nested navigation and selects their detail routes", () => {
  for (const id of ["products", "services", "orders", "leads", "customers"]) {
    expect(navigation.business.some(item => item.id === id)).toBe(false);
    expect(navigation.groups.flatMap(group => group.items).some(item => item.id === id)).toBe(false);
    expect(workspaceSection(`/b/shop/${id}/record`, "/b/shop", navigation)).toBe(id);
  }
});

it("provides direct management links without mixing agent configuration into operations", () => {
  for (const path of ["products", "services", "catalogs", "orders", "bookings", "leads"])
    expect(navigation.management.some(item => item.path === path)).toBe(true);
  for (const path of ["agents", "knowledge", "workflows", "sources", "instagram", "whatsapp"])
    expect(navigation.management.some(item => item.path === path)).toBe(false);
  expect(navigation.search.some(item => item.path === "business" && item.label === "Menaxhimi")).toBe(true);
});
