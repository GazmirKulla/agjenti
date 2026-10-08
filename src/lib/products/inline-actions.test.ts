import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductRow } from "./catalog";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), from: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { updateCatalogField } from "./inline-actions";

const id = "00000000-0000-4000-8000-000000000001";
const workflow = "00000000-0000-4000-8000-000000000002";
const type = "00000000-0000-4000-8000-000000000003";
const stamp = "2026-10-08T09:00:00.000Z";
let product: ProductRow & { business_id: string };
let queries: { table: string; eq: Record<string, unknown>; changes?: Record<string, unknown> }[];
let workflowAvailable: boolean, typeAvailable: boolean, staleDuringWrite: boolean, writeFails: boolean;
beforeEach(() => {
  vi.clearAllMocks(); queries = [];
  workflowAvailable = typeAvailable = true; staleDuringWrite = writeFails = false;
  product = { id, business_id: "business", name: "Puzzle", description: null, sku: null, image_url: null, source: "manual", external_id: null, price_amount: 25, currency: "EUR", product_type_id: type, workflow_id: workflow, is_active: false, updated_at: stamp };
  m.user.mockResolvedValue({ id: "user" }); m.access.mockResolvedValue({ business: { id: "business" } });
  m.from.mockImplementation((table: string) => {
    const query: typeof queries[number] = { table, eq: {} }; queries.push(query);
    const q = { select: () => q, eq: (key: string, value: unknown) => { query.eq[key] = value; return q; }, update: (changes: Record<string, unknown>) => { query.changes = changes; m.update(changes); return q; }, maybeSingle: async () => {
      if (table === "product_types") return { data: typeAvailable && query.eq.id === type && query.eq.is_active === true ? { id: type } : null, error: null };
      if (table === "workflows") return { data: workflowAvailable && query.eq.id === workflow && query.eq.business_id === "business" ? { id: workflow } : null, error: null };
      if (query.eq.id !== product.id || query.eq.business_id !== product.business_id) return { data: null, error: null };
      if (query.changes) {
        if (writeFails) return { data: null, error: { code: "failure" } };
        if (staleDuringWrite || query.eq.updated_at !== product.updated_at) return { data: null, error: null };
        product = { ...product, ...query.changes };
      }
      return { data: { ...product }, error: null };
    } };
    return q;
  });
});
const activate = () => updateCatalogField("test", { id, field: "is_active", value: true, updatedAt: stamp });

describe("inline product configuration", () => {
  it("rejects unauthenticated users and products outside the authorized business", async () => {
    m.user.mockResolvedValue(null); expect((await activate()).error).toBeTruthy();
    m.user.mockResolvedValue({ id: "user" }); m.access.mockResolvedValue(null); expect((await activate()).error).toBeTruthy();
    m.access.mockResolvedValue({ business: { id: "business" } }); product.business_id = "victim";
    expect((await activate()).error).toContain("biznes"); expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects unsupported fields, wrong value types and invalid references before writes", async () => {
    for (const change of [{ field: "price_amount", value: 0 }, { field: "is_active", value: "true" }, { field: "workflow_id", value: "bad-id" }]) {
      expect((await updateCatalogField("test", { id, updatedAt: stamp, ...change } as Parameters<typeof updateCatalogField>[1])).error).toBeTruthy();
    }
    expect(m.update).not.toHaveBeenCalled();
  });
  it("names activation requirements and refuses foreign workflows or inactive types", async () => {
    product.workflow_id = product.product_type_id = null; product.price_amount = null;
    expect((await activate()).error).toMatch(/çmimin.*llojin.*workflow-n/);
    product.workflow_id = workflow; product.product_type_id = type; product.price_amount = 0;
    workflowAvailable = false; expect((await activate()).error).toContain("këtë biznes");
    workflowAvailable = true; typeAvailable = false; expect((await activate()).error).toContain("nuk është aktiv");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("activates a valid free product and updates only its status with tenant and revision guards", async () => {
    product.price_amount = 0;
    const result = await activate();
    expect(result.product).toMatchObject({ is_active: true, price_amount: 0, workflow_id: workflow });
    expect(m.update.mock.calls[0][0]).toEqual({ is_active: true, updated_at: expect.any(String) });
    expect(queries.at(-1)).toMatchObject({ table: "products", eq: { business_id: "business", id, updated_at: stamp } });
  });
  it("can return an incomplete product to draft without requiring its broken references", async () => {
    product.is_active = true; product.product_type_id = null; product.price_amount = null;
    workflowAvailable = false;
    expect((await updateCatalogField("test", { id, field: "is_active", value: false, updatedAt: stamp })).product?.is_active).toBe(false);
    expect(queries.every(query => query.table === "products")).toBe(true);
  });
  it("removing a mapping automatically demotes an active product and preserves other fields", async () => {
    product.is_active = true;
    const result = await updateCatalogField("test", { id, field: "workflow_id", value: null, updatedAt: stamp });
    expect(result.product).toMatchObject({ workflow_id: null, is_active: false, product_type_id: type, price_amount: 25 });
    expect(result.success).toContain("draft");
    expect(m.update.mock.calls[0][0]).toEqual({ workflow_id: null, is_active: false, updated_at: expect.any(String) });
  });
  it("maps a draft without automatically publishing it", async () => {
    product.workflow_id = null;
    expect((await updateCatalogField("test", { id, field: "workflow_id", value: workflow, updatedAt: stamp })).product).toMatchObject({ workflow_id: workflow, is_active: false });
    expect(m.update.mock.calls[0][0]).not.toHaveProperty("is_active");
  });
  it("rejects both stale reads and a concurrent change between validation and writing", async () => {
    product.updated_at = "2026-10-08T10:00:00.000Z";
    expect((await activate()).error).toContain("ndryshoi"); expect(m.update).not.toHaveBeenCalled();
    product.updated_at = stamp; staleDuringWrite = true;
    expect((await activate()).error).toContain("ndryshoi"); expect(product.is_active).toBe(false);
  });
  it("reports database failures without claiming success", async () => {
    writeFails = true;
    expect(await activate()).toEqual({ error: "Ndryshimi nuk u ruajt. Provo përsëri." });
    expect(product.is_active).toBe(false);
  });
});
