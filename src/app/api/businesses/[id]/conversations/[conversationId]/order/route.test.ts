import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/lib/conversations/transport-access", async (actual) => ({
  ...(await actual<typeof import("@/lib/conversations/transport-access")>()),
  transportAccess: async () => ({ userId: "user" }),
}));
vi.mock("@/lib/capabilities/enforcement", async (actual) => ({
  ...(await actual<typeof import("@/lib/capabilities/enforcement")>()),
  requireRuntimeModules: async () => {},
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/orders/dispatch", () => ({ dispatchManualOrder: m.dispatch }));
import { manualOrderError } from "@/lib/orders/manual";
import { POST } from "./route";

const conversation = "11111111-1111-4111-8111-111111111111";
const tee = "22222222-2222-4222-8222-222222222222";
const puzzle = "33333333-3333-4333-8333-333333333333";
const variant = "44444444-4444-4444-8444-444444444444";
const customer = { name: "Ana Test", phone: "+38344111222", city: "Prishtinë", address: "Rr. 1" };

const send = (body: unknown) => POST(
  new Request("https://app.test/api/order", { method: "POST", body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: "business", conversationId: conversation }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  m.rpc.mockResolvedValue({ data: "order-1", error: null });
  m.dispatch.mockResolvedValue({ status: "accepted", externalOrderId: "Z-9" });
});

it("records several items in one order and sends it once", async () => {
  const response = await send({
    lines: [
      { productId: tee, variantId: variant, quantity: 2, selection: { options: { color: "c-red" }, fields: { theme: "Mace", empty: "" }, addons: ["gift"] } },
      { productId: puzzle, quantity: 1, selection: { files: { photo: ["b/c/x.jpg"] } } },
    ],
    customer, note: "shënim", requestKey: "key-two-lines",
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, orderId: "order-1", submission: { status: "accepted", externalOrderId: "Z-9" } });
  expect(m.rpc).toHaveBeenCalledTimes(1);
  const [name, args] = m.rpc.mock.calls[0];
  expect(name).toBe("create_manual_order_lines");
  expect(args.p_lines).toEqual([
    { productId: tee, variantId: variant, quantity: 2, selection: { options: { color: "c-red" }, fields: { theme: "Mace" }, files: {}, addons: ["gift"] } },
    { productId: puzzle, variantId: null, quantity: 1, selection: { options: {}, fields: {}, files: { photo: ["b/c/x.jpg"] }, addons: [] } },
  ]);
  expect(args).toMatchObject({ p_request_key: "key-two-lines", p_note: "shënim", p_customer: customer });
  expect(m.dispatch).toHaveBeenCalledTimes(1);
  expect(m.dispatch).toHaveBeenCalledWith({ businessId: "business", userId: "user", orderId: "order-1" });
});

it("still takes the one-product body that app 0.3.10 sends", async () => {
  const response = await send({ productId: tee, variantId: variant, quantity: 1, selection: { options: { color: "c-red" } }, customer, note: "", requestKey: "key-old-body" });
  expect(response.status).toBe(200);
  expect(m.rpc.mock.calls[0][1].p_lines).toEqual([
    { productId: tee, variantId: variant, quantity: 1, selection: { options: { color: "c-red" }, fields: {}, files: {}, addons: [] } },
  ]);
});

it("names the item whose error the database reports", async () => {
  m.rpc.mockResolvedValue({ data: null, error: { message: "selection_required:2" } });
  const response = await send({ lines: [{ productId: tee, quantity: 1 }, { productId: puzzle, quantity: 1 }], customer, requestKey: "key-missing-photo" });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/^Artikulli 2: Plotëso zgjedhjet/);
  expect(m.dispatch).not.toHaveBeenCalled();
});

it("keeps the plain message for a one-product order", async () => {
  m.rpc.mockResolvedValue({ data: null, error: { message: "variant_required:1" } });
  const response = await send({ productId: tee, quantity: 1, customer, requestKey: "key-old-variant" });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("Zgjidh variantin (p.sh. masën) e produktit.");
});

it("rejects a bad item, an empty basket and more than ten items before the database", async () => {
  const bad = await send({ lines: [{ productId: tee, quantity: 1 }, { productId: "nope", quantity: 1 }], customer, requestKey: "key-bad-line" });
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toBe("Artikulli 2: Zgjidh produktin dhe sasinë.");
  expect((await send({ lines: [], customer, requestKey: "key-empty" })).status).toBe(400);
  expect((await send({ lines: Array.from({ length: 11 }, () => ({ productId: tee, quantity: 1 })), customer, requestKey: "key-eleven" })).status).toBe(400);
  expect((await send({ lines: "x", customer, requestKey: "key-not-array" })).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});

it("maps line and order errors", () => {
  expect(manualOrderError("mixed_currency")).toEqual({ error: "Të gjithë artikujt e porosisë duhet të kenë të njëjtën monedhë.", status: 400 });
  expect(manualOrderError("invalid_quantity:3").error).toMatch(/^Artikulli 3: Sasia nuk vlen/);
  expect(manualOrderError("something_else:2")).toEqual({ error: "Porosia nuk u ruajt. Provo përsëri.", status: 500 });
});
