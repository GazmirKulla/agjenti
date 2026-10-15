import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Exercise the real service wrapper, module policy and isolation boundary together.
// Only the Supabase transport is replaced; no network or database writes.
const m = vi.hoisted(() => ({ rpc: vi.fn(), write: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: m.rpc,
    from: () => ({ insert: m.write, update: m.write, upsert: m.write, delete: m.write }),
  }),
}));
import { createServiceSupabase } from "@/lib/supabase/service";
import { requireRuntimeModules, runtimeModules } from "@/lib/capabilities/enforcement";
import { IsolationViolation, snapshotExternalActions } from "./execution-context";
import { runIsolated } from "./isolated-run";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-placeholder");
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "");
  m.rpc.mockResolvedValue({ data: ["products", "orders"], error: null });
});
afterEach(() => vi.unstubAllEnvs());

it("allows entitlement reads in an isolated turn without recording a mutation", async () => {
  await runIsolated(async () => {
    expect(await runtimeModules("tenant-a")).toEqual(["products", "orders"]);
    await requireRuntimeModules("tenant-a", ["products", "orders"]);
    expect(snapshotExternalActions()).toEqual([]);
  });
  expect(m.rpc).toHaveBeenCalledWith("allowed_business_modules", { p_business: "tenant-a" });
});

it("keeps each entitlement read scoped to its tenant", async () => {
  m.rpc.mockImplementation(async (_fn, args) => ({
    data: args.p_business === "tenant-a" ? ["products", "orders"] : ["services"], error: null,
  }));
  await runIsolated(async () => {
    expect(await runtimeModules("tenant-a")).toEqual(["products", "orders"]);
    expect(await runtimeModules("tenant-b")).toEqual(["services"]);
    await expect(requireRuntimeModules("tenant-b", ["orders"])).rejects.toMatchObject({ code: "module_disabled" });
  });
});

it.each([
  { data: null, error: { message: "RPC unavailable" } },
  { data: null, error: null },
  { data: { modules: ["orders"] }, error: null },
])("fails closed when entitlement evidence is unavailable: %j", async response => {
  m.rpc.mockResolvedValue(response);
  await expect(runIsolated(() => requireRuntimeModules("tenant-a", ["orders"])))
    .rejects.toMatchObject({ code: "unverified" });
});

it("does not turn a revoked entitlement into an available test capability", async () => {
  m.rpc.mockResolvedValue({ data: [], error: null });
  await expect(runIsolated(() => requireRuntimeModules("tenant-a", ["orders"])))
    .rejects.toMatchObject({ code: "module_disabled" });
});

it.each(["save_business_modules", "save_visual_workflow", "submit_confirmed_order", "unknown_rpc"])(
  "still blocks non-allowlisted RPC %s before transport", async fn => {
    await runIsolated(() => {
      expect(() => createServiceSupabase().rpc(fn, { p_business: "tenant-a" })).toThrow(IsolationViolation);
      expect(snapshotExternalActions()).toEqual([{ kind: "database.mutate", disposition: "BLOCKED", detail: `rpc:${fn}` }]);
    });
    expect(m.rpc).not.toHaveBeenCalled();
  },
);

it.each(["insert", "update", "upsert", "delete"] as const)("still blocks direct %s", async method => {
  await runIsolated(() => {
    const table = createServiceSupabase().from("orders");
    expect(() => method === "delete" ? table.delete() : table[method]({ business_id: "tenant-a" })).toThrow(IsolationViolation);
  });
  expect(m.write).not.toHaveBeenCalled();
});
