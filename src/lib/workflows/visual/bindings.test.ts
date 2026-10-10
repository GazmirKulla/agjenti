import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), version: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("./store", () => ({ loadVisualVersion: m.version }));
import { loadVisualBindings, loadVisualBindingCatalog } from "./bindings";
import { starterVisualGraph, upgradeVisualGraph } from "./model";
const productId = "00000000-0000-4000-8000-000000000001";
const serviceId = "00000000-0000-4000-8000-000000000002";
const queries: { table: string; tenant?: string; ids?: string[]; columns?: string }[] = [];
let enabled: boolean, missing: boolean, failed: boolean;
beforeEach(() => {
  vi.clearAllMocks(); queries.length = 0; enabled = true; missing = false; failed = false;
  const graph = upgradeVisualGraph(starterVisualGraph());
  graph.flows[0].productIds = [productId]; graph.flows[0].serviceIds = [serviceId];
  m.version.mockResolvedValue({ id: "published-v1", businessId: "business", graph });
  m.from.mockImplementation((table: string) => {
    const query: (typeof queries)[number] = { table }; queries.push(query);
    const chain = {
      select: (columns: string) => { query.columns = columns; return chain; },
      eq: (_key: string, tenant: string) => { query.tenant = tenant; return chain; },
      maybeSingle: async () => ({ data: { published_version_id: "published-v1", enabled }, error: null }),
      in: async (_key: string, ids: string[]) => {
        query.ids = ids;
        return { data: missing ? [] : table === "products" ? [{ id: productId, name: "Produkt test", is_active: false }] : [{ id: serviceId, name: "Shërbim test", is_active: false, booking_enabled: false }], error: failed ? { code: "08006" } : null };
      },
    }; return chain;
  });
});
it("reads only published assignments with verified tenant names, including inactive draft targets", async () => {
  const result = await loadVisualBindings("business");
  expect(result).toMatchObject({ versionId: "published-v1", enabled: true, products: [{ id: productId, name: "Produkt test", isActive: false, flowId: "handoff" }], services: [{ id: serviceId, name: "Shërbim test", isActive: false, bookingEnabled: false }] });
  expect(m.version).toHaveBeenCalledExactlyOnceWith("business", "published-v1");
  expect(queries.every(query => query.tenant === "business")).toBe(true);
  expect(queries[0].columns).not.toContain("draft");
});
it("does not turn disabled published bindings into active assignments", async () => {
  enabled = false;
  expect(await loadVisualBindings("business")).toMatchObject({ enabled: false, products: [{ id: productId }] });
});
it("does not expose a draft-only assignment as published", async () => {
  m.from.mockImplementationOnce(() => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { published_version_id: null, enabled: false }, error: null }) }; return query;
  });
  expect(await loadVisualBindings("business")).toEqual({ versionId: null, enabled: false, products: [], services: [] });
  expect(m.version).not.toHaveBeenCalled();
});
it("does not return deleted or foreign catalog targets", async () => {
  missing = true;
  expect(await loadVisualBindings("business")).toMatchObject({ products: [], services: [] });
});
it("does not hide catalog read failures as empty bindings", async () => {
  failed = true;
  await expect(loadVisualBindings("business")).rejects.toThrow("lidhjet");
});
it("needs no catalog queries for an unbound legacy graph", async () => {
  expect(await loadVisualBindingCatalog("business", [starterVisualGraph()])).toEqual({ products: [], services: [] });
  expect(m.from).not.toHaveBeenCalled();
});
