import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Real isolation guard, service-client wrapper, entitlements and enforcement.
// Supabase transport is replaced before client construction: no real DB/network.
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
import { runIsolated } from "@/lib/runtime/isolated-run";
import { runtimeModules } from "@/lib/capabilities/enforcement";
import { MODULE_IDS } from "@/lib/dashboard/modules/types";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "audit-placeholder-not-a-secret");
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "");
  mocks.rpc.mockResolvedValue({ data: [...MODULE_IDS], error: null });
});
afterEach(() => vi.unstubAllEnvs());

it("loads verified entitlement modules in normal live execution", async () => {
  await expect(runtimeModules("audit-live-tenant")).resolves.toEqual([...MODULE_IDS]);
  expect(mocks.rpc).toHaveBeenCalledWith("allowed_business_modules", { p_business: "audit-live-tenant" });
});

it("permits the same read-only entitlement check in an isolated Test Chat turn", async () => {
  // Test Chat and Chat Lab must verify exactly the same module permissions as
  // live conversation turns, without treating this read-only RPC as a mutation.
  await expect(runIsolated(() => runtimeModules("audit-isolated-tenant"))).resolves.toEqual([...MODULE_IDS]);
  expect(mocks.rpc).toHaveBeenCalledWith("allowed_business_modules", { p_business: "audit-isolated-tenant" });
});
