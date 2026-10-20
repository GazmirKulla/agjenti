import { beforeEach, expect, it, vi } from "vitest";
import { settingsGroups } from "@/lib/dashboard/navigation/settings";
import { organizeWorkspace } from "@/lib/dashboard/navigation/workspace";
import { buildNavigationItems } from "@/lib/dashboard/navigation/builder";
import { legacyDashboardProfile } from "@/lib/dashboard/profile/legacy";

const access = vi.hoisted(() => ({ user: vi.fn(), business: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: access.user, requireBusinessAccess: access.business }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/components/settings/layout", () => ({ SettingsLayout: () => null }));
import SettingsRoot from "./page";
import SettingsLayout from "./layout";
import AccountRedirect from "../account/page";
import BillingRedirect from "../billing/page";
import ActionsRedirect from "../actions/page";

beforeEach(() => {
  vi.resetAllMocks();
  access.user.mockResolvedValue({ id: "signed-in-user" });
  access.business.mockResolvedValue({ business: { id: "tenant-a", slug: "canonical-a", name: "Tenant A" } });
});
it.each([
  ["settings", SettingsRoot, "profile"],
  ["account", AccountRedirect, "profile"],
  ["billing", BillingRedirect, "billing"],
  ["actions", ActionsRedirect, "actions"],
] as const)("preserves %s deep links after checking the canonical tenant", async (_, page, target) => {
  await expect(page({ params: Promise.resolve({ slug: "old-alias" }) })).rejects.toThrow(`redirect:/b/canonical-a/settings/${target}`);
  expect(access.business).toHaveBeenCalledWith("signed-in-user", "old-alias");
});
it.each([SettingsRoot, AccountRedirect, BillingRedirect, ActionsRedirect])("rejects foreign tenant redirects", async page => {
  access.business.mockResolvedValue(null);
  await expect(page({ params: Promise.resolve({ slug: "tenant-b" }) })).rejects.toThrow("redirect:/auth/continue");
});
it.each([SettingsRoot, AccountRedirect, BillingRedirect, ActionsRedirect])("requires a current authenticated session", async page => {
  access.user.mockResolvedValue(null);
  await expect(page({ params: Promise.resolve({ slug: "tenant-a" }) })).rejects.toThrow("redirect:/login");
  expect(access.business).not.toHaveBeenCalled();
});
it("guards the whole nested workspace and derives identity from server access", async () => {
  const element = await SettingsLayout({ params: Promise.resolve({ slug: "old-alias" }), children: "existing page" });
  expect(element.props).toMatchObject({ slug: "canonical-a", name: "Tenant A", children: "existing page" });
  access.business.mockResolvedValue(null);
  await expect(SettingsLayout({ params: Promise.resolve({ slug: "tenant-b" }), children: "sensitive" })).rejects.toThrow("redirect:/auth/continue");
});
it("makes only supported destinations primary and retains optional modules in manual navigation", () => {
  const limited = organizeWorkspace(buildNavigationItems({ ...legacyDashboardProfile, navigationItems: ["dashboard", "inbox", "agents", "services", "settings"] }));
  expect(limited.main.map(item => item.path)).toEqual(["", "inbox", "activity"]);
  expect(limited.search.some(item => item.path === "services")).toBe(true);
  expect(limited.search.some(item => item.path === "products" || item.path === "customers" || item.path === "workflows")).toBe(false);
  const withCustomers = organizeWorkspace(buildNavigationItems({ ...legacyDashboardProfile, navigationItems: ["dashboard", "inbox", "customers", "settings"] }));
  expect(withCustomers.main.map(item => item.path)).toEqual(["", "inbox", "activity", "customers"]);
});
it("has one distinct route per settings section", () => {
  const routes = settingsGroups.flatMap(group => group.items.map(item => item.path));
  expect(routes).toEqual(["profile", "preferences", "business", "billing", "migo", "modules", "actions", "advanced"]);
  expect(new Set(routes).size).toBe(routes.length);
});
