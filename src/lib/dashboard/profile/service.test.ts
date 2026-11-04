import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn(), allowed: vi.fn(), rpc: vi.fn() }));
vi.mock("../modules/entitlements", () => ({ loadAllowedModules: m.allowed }));
import { MODULE_IDS } from "../modules/types";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: m.read }; return q;
} }) }));
import { loadDashboardProfile, loadNavigationProfile } from "./service";
import { rebuildProfileFromModules } from "./generate";
beforeEach(() => { vi.clearAllMocks(); m.allowed.mockResolvedValue([...MODULE_IDS]); m.rpc.mockResolvedValue({ data: [], error: null }); });
it.each([null, {}, { version: 1, source: "legacy", enabledModules: ["products"] }])("standard capabilities do not require activation: %j", async dashboard_profile => {
  m.read.mockResolvedValue({ data: { dashboard_profile }, error: null });
  expect((await loadDashboardProfile("tenant", { requireExplicit: true })).enabledModules).toEqual([...MODULE_IDS]);
});
it("does not hide database failures as an empty workspace", async () => {
  m.read.mockResolvedValue({ data: null, error: { code: "unavailable" } });
  await expect(loadDashboardProfile("tenant")).rejects.toThrow();
});
it("hidden menus never remove capabilities", async () => {
  const stored = { ...rebuildProfileFromModules(["products"]), hiddenModules: ["services"] };
  m.read.mockResolvedValue({ data: { dashboard_profile: stored }, error: null });
  m.rpc.mockResolvedValue({ data: ["services"], error: null });
  const profile = await loadNavigationProfile("tenant");
  expect(profile.enabledModules).toContain("services");
  expect(profile.navigationItems).not.toContain("services");
  expect(stored.enabledModules).not.toContain("services");
});
it("shows empty allowed sections even when onboarding did not select them", async () => {
  const stored = { ...rebuildProfileFromModules([]), source: "generated" };
  m.read.mockResolvedValue({ data: { dashboard_profile: stored }, error: null });
  const profile = await loadNavigationProfile("tenant");
  for (const id of ["products", "services", "orders", "bookings", "knowledge", "workflows"])
    expect(profile.navigationItems).toContain(id);
  expect(m.rpc).not.toHaveBeenCalled();
  expect(stored.enabledModules).not.toContain("services");
});
it("never adds unpermitted modules, including core modules, to navigation", async () => {
  m.read.mockResolvedValue({ data: { dashboard_profile: null }, error: null });
  m.allowed.mockResolvedValue(["dashboard", "inbox", "products"]);
  const profile = await loadNavigationProfile("tenant");
  expect(profile.navigationItems).toEqual(["dashboard", "inbox", "products"]);
  expect(profile.mobileNavigationItems.every(id => profile.enabledModules.includes(id))).toBe(true);
});

it("lets the owner show bookings while hiding the services menu", async () => {
  m.read.mockResolvedValue({ data: { dashboard_profile: { version: 1, source: "manual", enabledModules: ["bookings"], hiddenModules: ["services"] } }, error: null });
  const profile = await loadNavigationProfile("tenant");
  expect(profile.navigationItems).toContain("bookings");
  expect(profile.navigationItems).not.toContain("services");
});
it("fails closed when server capabilities cannot be read", async () => {
  m.read.mockResolvedValue({ data: { dashboard_profile: null }, error: null });
  m.allowed.mockRejectedValue(new Error("unavailable"));
  await expect(loadDashboardProfile("tenant")).rejects.toThrow("unavailable");
});
