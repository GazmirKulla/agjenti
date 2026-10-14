import { beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
const allowed = vi.hoisted(() => vi.fn());
vi.mock("../modules/entitlements", () => ({ loadAllowedModules: allowed }));
import { MODULE_IDS } from "../modules/types";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: read }; return q;
} }) }));
import { loadDashboardProfile } from "./service";
import { rebuildProfileFromModules } from "./generate";
beforeEach(() => { read.mockReset(); allowed.mockResolvedValue([...MODULE_IDS]); });
it.each([null, {}, { version: 1, source: "legacy", enabledModules: ["products"] }])("requires an explicit module profile for enforced tenants: %j", async dashboard_profile => {
  read.mockResolvedValue({ data: { dashboard_profile }, error: null });
  await expect(loadDashboardProfile("tenant", { requireExplicit: true })).rejects.toThrow("Konfirmo modulet");
  await expect(loadDashboardProfile("tenant")).resolves.toHaveProperty("source", "legacy");
});
it("does not fall back to permissive legacy modules on a missing column for enrolled tenants", async () => {
  read.mockResolvedValue({ data: null, error: { code: "42703" } });
  await expect(loadDashboardProfile("tenant", { requireExplicit: true })).rejects.toThrow();
  await expect(loadDashboardProfile("tenant")).resolves.toHaveProperty("source", "legacy");
});
it("reads explicit current modules without restoring disabled dependencies", async () => {
  read.mockResolvedValue({ data: { dashboard_profile: rebuildProfileFromModules(["products", "workflows"]) }, error: null });
  const profile = await loadDashboardProfile("tenant", { requireExplicit: true });
  expect(profile.enabledModules).toContain("products"); expect(profile.enabledModules).not.toContain("orders");
});

it("removes denied modules and dependent routes without modifying stored preferences", async () => {
  const stored = rebuildProfileFromModules(["products", "orders", "services", "bookings", "calendar", "workflows"]);
  read.mockResolvedValue({ data: { dashboard_profile: stored }, error: null });
  allowed.mockResolvedValue(MODULE_IDS.filter(id => id !== "services" && id !== "products"));
  const effective = await loadDashboardProfile("tenant");
  for (const id of ["products", "orders", "services", "bookings", "calendar"]) {
    expect(effective.enabledModules).not.toContain(id);
    expect(effective.navigationItems).not.toContain(id);
  }
  expect(stored.enabledModules).toContain("products");
  expect(effective.enabledModules).toContain("workflows");
});
it("fails closed when platform permissions cannot be read", async () => {
  read.mockResolvedValue({ data: { dashboard_profile: null }, error: null });
  allowed.mockRejectedValue(new Error("unavailable"));
  await expect(loadDashboardProfile("tenant")).rejects.toThrow("unavailable");
});
