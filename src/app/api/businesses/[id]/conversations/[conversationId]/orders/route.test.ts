import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), ensure: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user" } } }) } }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("@/lib/tenant/access", () => ({ isPlatformAdmin: async () => true }));
vi.mock("@/lib/conversations/ensure-customer", () => ({ ensureCustomerForConversation: m.ensure }));
vi.mock("@/lib/integrations/zana", () => ({ submitExternalOrder: m.submit }));
import { POST } from "./route";
import { emptyState } from "@/lib/workflows/engine";
import { migrateContext } from "@/lib/workflows/context";
import { bookingAdapterState, snapshotOrder } from "@/lib/workflows/conversation-processes";
let state: Record<string, unknown>;
let filters: [string, string, unknown][];
beforeEach(() => {
  vi.clearAllMocks(); filters = [];
  state = { schemaVersion: 3, product_id: "product", step_key: "order_ready", context: { execution: { orderConfirmed: true } }, customer: { name: "Test", phone: "0690000000", address: "Test" } };
  m.from.mockImplementation((table: string) => {
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([table,key,value]); return q; },
      maybeSingle: async () => ({ data: table === "conversations" ? { id: "conversation", customer_id: null } : table === "conversation_states" ? { collected: state } : null }) };
    return q;
  });
});
const send = () => POST(new Request("https://app.test/api/orders", { method: "POST" }), { params: Promise.resolve({ id: "business", conversationId: "conversation" }) });
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
  const confirmed = migrateContext(emptyState());
  confirmed.product_id = "product"; confirmed.step_key = "order_ready";
  confirmed.customer = { name: "Test", phone: "0690000000", city: "Test", address: "Test address" };
  confirmed.fields = { size: "M" }; confirmed.context!.execution.orderConfirmed = true;
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
