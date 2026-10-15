// Existing scenarios run with the default platform policy: all modules allowed.
vi.mock("@/lib/dashboard/modules/entitlements", async () => {
  const { MODULE_IDS } = await import("@/lib/dashboard/modules/types");
  return { loadAllowedModules: async () => [...MODULE_IDS], requireModuleAllowed: async () => {} };
});
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), ensure: vi.fn(), submit: vi.fn(), profile: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: m.profile }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user" } } }) } }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("@/lib/tenant/access", () => ({ isPlatformAdmin: m.admin }));
vi.mock("@/lib/conversations/ensure-customer", () => ({ ensureCustomerForConversation: m.ensure }));
vi.mock("@/lib/integrations/zana", () => ({ submitExternalOrder: m.submit }));
import { PATCH, POST } from "./route";
import { emptyState } from "@/lib/workflows/engine";
import { advanceSharedOrder, migrateContext, setFact, setOrderTerms } from "@/lib/workflows/context";
import { bookingAdapterState, snapshotOrder } from "@/lib/workflows/conversation-processes";
let state: Record<string, unknown>;
let filters: [string, string, unknown][];
function confirmedOrder() {
  let next = migrateContext(emptyState());
  next.product_id = "product"; next.step_key = "collect_customer";
  setOrderTerms(next, { id: "product", price_amount: 1200, currency: "ALL" });
  for (const [key, value] of Object.entries({ name: "Test", phone: "0690000000", city: "Test", address: "Test address" }))
    setFact(next, `customer_${key}`, value, "text", "test");
  setFact(next, "size", "M", "text", "test");
  const steps = [{ key: "size", kind: "text" as const }, { key: "collect_customer", kind: "customer" as const }];
  next.context!.execution.linear = { id: "workflow", versionId: "published-linear", name: "Order", steps };
  next = advanceSharedOrder(next, "", false, steps);
  return advanceSharedOrder(next, "Po", false, steps);
}
beforeEach(() => {
  vi.clearAllMocks(); filters = [];
  m.admin.mockResolvedValue(true);
  state = confirmedOrder() as unknown as Record<string, unknown>;
  m.from.mockImplementation((table: string) => {
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([table,key,value]); return q; },
      maybeSingle: async () => ({ data: table === "conversations" ? { id: "conversation", customer_id: null } : table === "conversation_states" ? { collected: state, revision: 4, cart: [] } : null }) };
    return q;
  });
});
const send = () => POST(new Request("https://app.test/api/orders", { method: "POST" }), { params: Promise.resolve({ id: "business", conversationId: "conversation" }) });
it.each(["expired", "product", "phone", "legacy", "snapshot"])("W2 rejects %s-stale order approval before any writes", async change => {
  const next = confirmedOrder();
  if (change === "expired") next.context!.execution.orderReview!.expiresAt = Date.now() - 1;
  if (change === "product") next.product_id = "other-product";
  if (change === "phone") setFact(next, "customer_phone", "0692222222", "phone", "correction");
  if (change === "legacy") delete next.context!.execution.orderReview;
  if (change === "snapshot") {
    next.processes = { active: "order", order: { id: "o", status: "active", snapshot: snapshotOrder(next) } };
    setFact(next, "size", "L", "text", "correction");
  }
  state = next as unknown as Record<string, unknown>;
  expect((await send()).status).toBe(400);
  expect(m.ensure).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
});
afterEach(() => vi.unstubAllEnvs());
it("blocks direct order execution after module deactivation before CRM or external writes", async () => {
  vi.stubEnv("MODULE_ENFORCEMENT_BUSINESS_IDS", "business");
  m.profile.mockResolvedValue({ enabledModules: ["products", "workflows"] });
  const response = await send();
  expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: "module_disabled" });
  expect(m.ensure).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
  expect(m.from.mock.calls.map(c => c[0])).not.toContain("orders");
});
it.each([2,3])("requires final confirmation for schema %s before staff order creation", async schemaVersion => {
  state.schemaVersion = schemaVersion; state.context = { execution: { orderConfirmed: false } };
  expect((await send()).status).toBe(400);
  expect(m.ensure).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
});
it("does not create a product order from a service-only visual run", async () => {
  state.product_id = null;
  expect((await send()).status).toBe(400);
  expect(m.ensure).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
});
it("revalidates product ownership before creating CRM or order records", async () => {
  expect((await send()).status).toBe(400);
  expect(filters).toContainEqual(["products","business_id","business"]);
  expect(m.ensure).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
});
it("submits the confirmed order snapshot while a booking owns the current cursor", async () => {
  const confirmed = confirmedOrder();
  confirmed.processes = { active: "booking", order: { id: "order-run", status: "completed", snapshot: snapshotOrder(confirmed) } };
  state = bookingAdapterState(confirmed) as unknown as Record<string, unknown>;
  const inserted: Record<string, unknown>[] = [];
  m.from.mockImplementation((table: string) => {
    const q = { select: () => q, eq: () => q, update: () => q,
      insert: (row: Record<string, unknown>) => { if (table === "orders") inserted.push(row); return q; },
      single: async () => ({ data: { id: "new-order" } }),
      maybeSingle: async () => ({ data: table === "conversations" ? { id: "conversation" } : table === "conversation_states" ? { collected: state, revision: 4, cart: [] } : table === "products" ? { id: "product", name: "Puzzle", price_amount: 1200, currency: "ALL" }
        : table === "linear_workflow_versions" ? { id: "published-linear", steps: [{ key: "size", kind: "text" }, { key: "collect_customer", kind: "customer" }] } : null }),
    }; return q;
  });
  m.ensure.mockResolvedValue({ ok: true, customerId: "customer" });
  m.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "submit_confirmed_order") inserted.push({ payload: args.p_order });
    return { data: { orderId: "new-order", attemptId: "attempt", status: name === "submit_confirmed_order" ? "pending_reconciliation" : "local_only", dispatch: name === "submit_confirmed_order", payload: {} } };
  });
  m.submit.mockResolvedValue({ ok: true, skipped: true, status: "local_only" });
  expect((await send()).status).toBe(200);
  expect(inserted[0].payload).toMatchObject({ product_id: "product", step_key: "order_ready", fields: { size: "M" } });
  expect((state as { product_id?: string }).product_id).toBeNull();
});
it("does not submit an order snapshot whose confirmation was invalidated", async () => {
  const confirmed = migrateContext(emptyState());
  confirmed.product_id = "product"; confirmed.step_key = "order_ready";
  confirmed.context!.execution.orderConfirmed = false;
  confirmed.processes = { active: "booking", order: { id: "order-run", status: "suspended", snapshot: snapshotOrder(confirmed) } };
  state = bookingAdapterState(confirmed) as unknown as Record<string, unknown>;
  expect((await send()).status).toBe(400);
  expect(m.ensure).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
});
it.each([POST, PATCH])("W4 revoked membership / cross-tenant access cannot submit or reconcile", async method => {
  m.admin.mockResolvedValue(false);
  expect((await method(new Request("https://app.test/orders", { method: method === POST ? "POST" : "PATCH", body: JSON.stringify({ orderId: "foreign" }) }), { params: Promise.resolve({ id: "business", conversationId: "conversation" }) })).status).toBe(403);
  expect(filters).toContainEqual(["business_users", "business_id", "business"]);
  expect(filters).toContainEqual(["business_users", "user_id", "user"]);
  expect(m.rpc).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
});
it("W4 ignores client confirmation, product, price and intent overrides", async () => {
  state = { ...confirmedOrder(), step_key: "collect_customer" };
  const response = await POST(new Request("https://app.test/orders", { method: "POST", body: JSON.stringify({ orderConfirmed: true, productId: "foreign", price: 0, intentId: "client-key" }) }), { params: Promise.resolve({ id: "business", conversationId: "conversation" }) });
  expect(response.status).toBe(400); expect(m.rpc).not.toHaveBeenCalled(); expect(m.submit).not.toHaveBeenCalled();
});
