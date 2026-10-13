import { beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: read }; return q;
} }) }));
import { loadDashboardProfile } from "./service";
import { rebuildProfileFromModules } from "./generate";
beforeEach(() => read.mockReset());
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
