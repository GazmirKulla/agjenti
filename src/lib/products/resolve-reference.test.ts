// Existing scenarios run with the default platform policy: all modules allowed.
vi.mock("@/lib/dashboard/modules/entitlements", async () => {
  const { MODULE_IDS } = await import("@/lib/dashboard/modules/types");
  return { loadAllowedModules: async () => [...MODULE_IDS], requireModuleAllowed: async () => {} };
});
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], filters: [] as unknown[][], profile: vi.fn(), from: vi.fn(), error: false }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: m.profile }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
import { resolveCurrentProductReference, resolveCurrentServiceReference } from "./resolve-reference";
import { emptyState } from "@/lib/workflows/engine";
import { recordEntityPresentation } from "./entity-bridge";
import { rememberTurn } from "@/lib/workflows/guidance";
beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); m.filters = []; m.error = false;
  m.rows = [
    { id: "active", name: "Puzzle", business_id: "business", is_active: true },
    { id: "inactive", name: "Poster", business_id: "business", is_active: false },
    { id: "foreign", name: "Libri", business_id: "foreign", is_active: true },
  ];
  m.from.mockImplementation(() => {
    const filters: ((p: Record<string, unknown>) => boolean)[] = []; let bounds = [0, 499];
    const chain = { select: () => chain, order: () => chain, range: (start: number, end: number) => { bounds = [start, end]; return chain; },
      eq: (key: string, value: unknown) => { m.filters.push([key, value]); filters.push(p => p[key] === value); return chain; },
      then: (fn: (r: unknown) => unknown) => Promise.resolve({ data: m.rows.filter(p => filters.every(f => f(p))).slice(bounds[0], bounds[1] + 1), error: m.error ? {} : null }).then(fn) };
    return chain;
  });
});
describe("W3 server revalidation", () => {
  it.each(["inactive", "foreign"])("2B service %s is rejected by the current tenant catalog", async verifiedId => {
    expect(await resolveCurrentServiceReference({ businessId: "business", message: "i pari", verifiedId, mode: "test" })).toMatchObject({ status: "clarify", reason: "unavailable" });
    expect(m.from).toHaveBeenCalledWith("booking_services");
    expect(m.filters).toContainEqual(["business_id", "business"]);
    expect(m.filters).toContainEqual(["is_active", true]);
  });
  it("2B service discovery requires Services, but not booking authorization", async () => {
    vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "business");
    m.profile.mockResolvedValue({ enabledModules: ["knowledge"] });
    await expect(resolveCurrentServiceReference({ businessId: "business", message: "Puzzle" })).rejects.toMatchObject({ code: "module_disabled" });
    expect(m.from).not.toHaveBeenCalled();
    m.profile.mockResolvedValue({ enabledModules: ["services"] });
    expect(await resolveCurrentServiceReference({ businessId: "business", message: "Puzzle" })).toMatchObject({ status: "selected", service: { id: "active" } });
  });
  it("2B service catalog read errors fail closed", async () => {
    m.error = true;
    expect(await resolveCurrentServiceReference({ businessId: "business", message: "Puzzle" })).toMatchObject({ status: "clarify", reason: "catalog_unverified" });
  });
  it.each(["inactive", "foreign"])("rejects %s even with an ID from a prior approval", async verifiedId => {
    const result = await resolveCurrentProductReference({ businessId: "business", message: "po", verifiedId, mode: "test" });
    expect(result).toMatchObject({ status: "clarify", reason: "unavailable" });
    expect(m.filters).toEqual(expect.arrayContaining([["business_id", "business"], ["is_active", true]]));
  });
  it("rejects a product deactivated after it was actually presented", async () => {
    const state = emptyState();
    recordEntityPresentation(state, "business", "Poster", [{ id: "inactive", name: "Poster" }]);
    rememberTurn(null, state, "Produktet?", "Poster");
    expect(await resolveCurrentProductReference({ businessId: "business", message: "këtë", state, mode: "test" })).toMatchObject({ status: "clarify", reason: "unavailable" });
  });
  it("checks order capability readiness again before permitting a binding", async () => {
    vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "business");
    m.profile.mockResolvedValue({ enabledModules: ["products", "workflows"] });
    await expect(resolveCurrentProductReference({ businessId: "business", message: "Puzzle" })).rejects.toMatchObject({ code: "module_disabled" });
    m.profile.mockResolvedValue({ enabledModules: ["products", "workflows", "orders"] });
    expect(await resolveCurrentProductReference({ businessId: "business", message: "Puzzle" })).toMatchObject({ status: "selected", product: { id: "active" } });
  });
  it("fails closed when the catalog cannot be checked and never exposes a write API", async () => {
    m.error = true;
    expect(await resolveCurrentProductReference({ businessId: "business", message: "Puzzle" })).toMatchObject({ status: "clarify", reason: "catalog_unverified" });
  });
  it("paginates the tenant catalog instead of silently losing later entries", async () => {
    m.rows = Array.from({ length: 502 }, (_, i) => ({ id: String(i), name: `Product ${i}`, business_id: "business", is_active: true }));
    expect(await resolveCurrentProductReference({ businessId: "business", message: "Product 501" })).toMatchObject({ status: "selected", product: { id: "501" } });
    expect(m.from).toHaveBeenCalledTimes(2);
  });
});
