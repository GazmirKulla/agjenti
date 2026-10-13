import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), ensure: vi.fn(), submit: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/dashboard/profile/service", () => ({ loadDashboardProfile: m.profile }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user" } } }) } }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("@/lib/tenant/access", () => ({ isPlatformAdmin: async () => true }));
vi.mock("@/lib/conversations/ensure-customer", () => ({ ensureCustomerForConversation: m.ensure }));
vi.mock("@/lib/integrations/zana", () => ({ submitExternalOrder: m.submit }));
import { POST } from "./route";
import { emptyState } from "@/lib/workflows/engine";
import { advanceSharedOrder, migrateContext, setFact } from "@/lib/workflows/context";
import { bookingAdapterState, snapshotOrder } from "@/lib/workflows/conversation-processes";
let state: Record<string, unknown>;
let filters: [string, string, unknown][];
function confirmedOrder() {
  let next = migrateContext(emptyState());
  next.product_id = "product"; next.step_key = "collect_customer";
  for (const [key, value] of Object.entries({ name: "Test", phone: "0690000000", city: "Test", address: "Test address" }))
    setFact(next, `customer_${key}`, value, "text", "test");
  setFact(next, "size", "M", "text", "test");
  const steps = [{ key: "size", kind: "text" as const }, { key: "collect_customer", kind: "customer" as const }];
  next = advanceSharedOrder(next, "", false, steps);
  return advanceSharedOrder(next, "Po", false, steps);
}
beforeEach(() => {
  vi.clearAllMocks(); filters = [];
  state = confirmedOrder() as unknown as Record<string, unknown>;
  m.from.mockImplementation((table: string) => {
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([table,key,value]); return q; },
      maybeSingle: async () => ({ data: table === "conversations" ? { id: "conversation", customer_id: null } : table === "conversation_states" ? { collected: state } : null }) };
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
      maybeSingle: async () => ({ data: table === "conversations" ? { id: "conversation" } : table === "conversation_states" ? { collected: state } : table === "products" ? { id: "product", name: "Puzzle", price_amount: 1200 } : null }),
    }; return q;
  });
  m.ensure.mockResolvedValue({ ok: true, customerId: "customer" });
  m.submit.mockResolvedValue({ ok: true, skipped: true });
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
