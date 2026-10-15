import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VisualGraphV2 } from "@/lib/workflows/visual/types";

const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), profile: vi.fn(), user: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: m.profile }));
vi.mock("@/lib/dashboard/modules/entitlements", () => ({ loadAllowedModules: async () => ["products", "orders", "workflows"] }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: m.user, requireBusinessAccess: m.access }));
vi.mock("@/lib/workflows/readiness", () => ({ loadWorkflowReadiness: async () => ({ ready: true, blockers: [] }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { updateCatalogField } from "./inline-actions";
import { assessBusinessCapabilities } from "@/lib/capabilities/assessment";
import { writeVisualWorkflow } from "@/lib/workflows/visual/mutations";
import { enforceOrderWorkflow } from "@/lib/capabilities/workflow";

const businessId = "synthetic-bootstrap";
const productId = "00000000-0000-4000-8000-000000000001";
const typeId = "00000000-0000-4000-8000-000000000002";
const graph: VisualGraphV2 = {
  version: 2, name: "Synthetic retail", nodes: [
    { id: "start", kind: "start", label: "Start", config: {}, position: { x: 0, y: 0 } },
    { id: "size", kind: "collect", label: "Size", config: { fieldKey: "size", fieldType: "text", prompt: "Size?" }, position: { x: 1, y: 0 } },
    { id: "end", kind: "end", label: "End", config: {}, position: { x: 2, y: 0 } },
  ], edges: [{ id: "a", source: "start", target: "size", port: "next" }, { id: "b", source: "size", target: "end", port: "next" }],
  flows: [{ id: "order", kind: "order", label: "Order", entryNodeId: "size", nodeIds: ["size"], productIds: [productId] }],
};
let product: Record<string, unknown>;
let writes: string[];
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", businessId);
  writes = [];
  product = { id: productId, business_id: businessId, name: "Synthetic item", product_type_id: typeId, workflow_id: null, price_amount: 25, currency: "EUR", is_active: false, updated_at: "2026-10-15T10:00:00Z" };
  m.profile.mockResolvedValue({ enabledModules: ["products", "orders", "workflows"] });
  m.user.mockResolvedValue({ id: "actor" }); m.access.mockResolvedValue({ business: { id: businessId } });
  m.from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {};
    let changes: Record<string, unknown> | undefined;
    const result = () => {
      let rows: Record<string, unknown>[] = table === "products" ? [product] : table === "product_types" ? [{ id: typeId, is_active: true }]
        : table === "business_users" ? [{ user_id: "actor", business_id: businessId }] : [];
      rows = rows.filter(row => Object.entries(filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
      if (changes && rows.length) { Object.assign(product, changes); writes.push(table); }
      return { data: rows, error: null, count: rows.length };
    };
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
      in: (key: string, value: unknown) => { filters[key] = value; return q; }, update: (v: Record<string, unknown>) => { changes = v; return q; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data[0] ?? null }; },
      then: (resolve: (r: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    }; return q;
  });
  m.rpc.mockImplementation(async (name, args) => { writes.push(name); return { data: args.p_revision + 1, error: null }; });
});
afterEach(() => vi.unstubAllEnvs());
const activate = () => updateCatalogField("synthetic", { id: productId, field: "is_active", value: true, updatedAt: String(product.updated_at) });

it("bootstraps catalog activation before the first workflow publication without enabling any action", async () => {
  // Real actions/assessment/policy; only persistence and deployment health are doubles.
  expect((await activate()).error).toBeUndefined();
  expect(product.is_active).toBe(true);
  expect(writes).toEqual(["products"]);
  expect(await assessBusinessCapabilities(businessId, { userId: "actor" }, { keys: ["product.search", "order.prepare"] }))
    .toEqual([expect.objectContaining({ status: "ready" }), expect.objectContaining({ status: "needs_setup", missingRequirements: ["published_order_flow"] })]);
  expect(await assessBusinessCapabilities(businessId, { userId: "actor" }, { keys: ["product.search", "order.prepare"], candidate: graph }))
    .toEqual([expect.objectContaining({ status: "ready" }), expect.objectContaining({ status: "ready" })]);
  const draft = await writeVisualWorkflow(businessId, "actor", 0, graph, "draft");
  expect(draft.savedRevision).toBe(1);
  expect(m.rpc).toHaveBeenLastCalledWith("save_visual_workflow", expect.objectContaining({ p_operation: "draft" }));
  expect((await writeVisualWorkflow(businessId, "actor", 1, graph, "publish")).savedRevision).toBe(2);
  expect(writes).not.toContain("submit_confirmed_order");
});
it("allows inactive tenant bindings in drafts, but never publication or reactivation", async () => {
  expect((await writeVisualWorkflow(businessId, "actor", 0, graph, "draft")).savedRevision).toBe(1);
  const published = await writeVisualWorkflow(businessId, "actor", 1, graph, "publish");
  expect(published.error).toBeTruthy();
  expect(m.rpc).toHaveBeenCalledTimes(1);
});
it("does not activate with the products module disabled", async () => {
  m.profile.mockResolvedValue({ enabledModules: ["orders", "workflows"] });
  expect((await activate()).error).toBeTruthy(); expect(writes).toEqual([]);
});
it("allows catalog discovery setup while orders is disabled; order publication stays blocked", async () => {
  m.profile.mockResolvedValue({ enabledModules: ["products", "workflows"] });
  expect((await activate()).product?.is_active).toBe(true);
  const result = await writeVisualWorkflow(businessId, "actor", 0, graph, "publish");
  expect(result.publication).toMatchObject({ result: "BLOCKED", canPublish: false });
  expect(result.publication?.findings[0]).toMatchObject({ capabilityKey: "order.prepare", reasonCode: "module_disabled", missingRequirements: ["module:orders"] });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects a product from another tenant without a mutation", async () => {
  product.business_id = "foreign";
  expect((await activate()).error).toBeTruthy(); expect(writes).toEqual([]);
  expect((await writeVisualWorkflow(businessId, "actor", 0, graph, "draft")).error).toBeTruthy();
  expect(writes).toEqual([]);
});
it("permits the first legacy workflow configuration after catalog activation, not execution", async () => {
  await activate();
  await expect(enforceOrderWorkflow(businessId, "actor", [productId])).resolves.toBeUndefined();
  expect((await assessBusinessCapabilities(businessId, { userId: "actor" }, { keys: ["order.prepare"] }))[0])
    .toMatchObject({ status: "needs_setup", missingRequirements: ["published_order_flow"] });
  m.profile.mockResolvedValue({ enabledModules: ["products", "workflows"] });
  await expect(enforceOrderWorkflow(businessId, "actor", [productId])).rejects.toMatchObject({ code: "module_disabled" });
  expect(m.rpc).not.toHaveBeenCalled();
});
