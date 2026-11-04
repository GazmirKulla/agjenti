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
it("reveals the service section from persisted usage without changing preferences", async () => {
  const stored = rebuildProfileFromModules([]);
  m.read.mockResolvedValue({ data: { dashboard_profile: stored }, error: null });
  expect((await loadNavigationProfile("tenant")).navigationItems).not.toContain("services");
  m.rpc.mockResolvedValue({ data: ["services"], error: null });
  expect((await loadNavigationProfile("tenant")).navigationItems).toContain("services");
  expect(m.rpc).toHaveBeenCalledWith("business_used_modules", { p_business: "tenant" });
  expect(stored.enabledModules).not.toContain("services");
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
