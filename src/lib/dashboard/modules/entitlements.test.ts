import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc }) }));
import { loadAllowedModules, requireModuleAllowed } from "./entitlements";
import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
beforeEach(() => { rpc.mockReset(); vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", ""); });
it("applies platform revocation even outside the workspace-enforcement rollout", async () => {
  rpc.mockResolvedValue({ data: ["dashboard", "inbox", "services"], error: null });
  await expect(requireRuntimeModules("tenant", ["products"])).rejects.toMatchObject({ code: "module_disabled" });
  await expect(requireModuleAllowed("tenant", "catalogs")).rejects.toThrow("nuk lejohet");
  await expect(requireRuntimeModules("tenant", ["services"])).resolves.toBeUndefined();
  expect(rpc).toHaveBeenCalledWith("allowed_business_modules", { p_business: "tenant" });
});
it("fails closed on unavailable policy data instead of restoring legacy permissions", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
  await expect(loadAllowedModules("tenant")).rejects.toThrow("Nuk u verifikuan");
  await expect(requireRuntimeModules("tenant", ["products"])).rejects.toMatchObject({ code: "unverified" });
});
