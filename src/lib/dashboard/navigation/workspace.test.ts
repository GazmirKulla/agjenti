import { expect, it } from "vitest";
import { organizeWorkspace, workspaceSection, activeWorkspaceLink } from "./workspace";
import { buildAdminNavigation, buildNavigationItems } from "./builder";
import { legacyDashboardProfile } from "../profile/legacy";
import { moduleRegistry, navigationOrder } from "../modules/registry";

const allItems = navigationOrder.map(id => ({ ...moduleRegistry[id] }));
const navigation = organizeWorkspace(allItems);

it("retains a reachable destination and search result for every existing module", () => {
  const destinations = [...navigation.primary, ...navigation.agent, ...navigation.settings, ...navigation.business];
  for (const item of allItems) {
    expect(destinations.some(destination => destination.path === item.path), item.id).toBe(true);
    expect(navigation.search.some(destination => destination.path === item.path && destination.label === item.label), item.id).toBe(true);
  }
  expect(navigation.primary.map(item => item.label)).toEqual(["Kreu", "Bisedat", "Agjenti im", "Aktiviteti", "Cilësimet"]);
});

it("groups workflow and its deep links under the agent while keeping the original URL", () => {
  expect(navigation.agent.find(item => item.id === "workflows")?.path).toBe("workflows");
  expect(workspaceSection("/b/shop/workflows", "/b/shop", navigation)).toBe("agent");
  expect(workspaceSection("/b/shop/agents/memory", "/b/shop", navigation)).toBe("agent");
  expect(activeWorkspaceLink("/b/shop/agents/memory", "/b/shop", navigation.agent)).toBe("agents/memory");
  expect(activeWorkspaceLink("/b/shop/agents/test", "/b/shop", navigation.agent)).toBe("agents/test");
});

it("keeps operational details, channel settings, onboarding and accounts reachable", () => {
  expect(workspaceSection("/b/shop/products/record", "/b/shop", navigation)).toBe("business");
  expect(workspaceSection("/b/shop/inbox/record/customer", "/b/shop", navigation)).toBe("conversations");
  for (const path of ["staff", "instagram", "whatsapp", "setup", "account"]) expect(workspaceSection(`/b/shop/${path}`, "/b/shop", navigation)).toBe("settings");
  expect(workspaceSection("/b/shop/activity", "/b/shop", navigation)).toBe("activity");
  expect(workspaceSection("/b/other/workflows", "/b/shop", navigation)).toBeUndefined();
  expect(workspaceSection("/b/shop/workflows-other", "/b/shop", navigation)).toBeUndefined();
});

it("does not expose optional modules omitted by the business profile", () => {
  const limited = organizeWorkspace(buildNavigationItems({ ...legacyDashboardProfile, navigationItems: ["dashboard", "inbox", "agents", "services", "settings"] }));
  expect(limited.business.map(item => item.id)).toEqual(["services"]);
  expect(limited.search.some(item => item.path === "products" || item.path === "workflows")).toBe(false);
  expect(limited.agent.map(item => item.path)).toEqual(["agents", "agents/memory", "agents/test"]);
});

it("leaves administrator navigation independent of the business grouping", () => {
  expect(buildAdminNavigation("mobile").map(item => item.path)).toEqual(["", "businesses", "conversations", "app"]);
});
