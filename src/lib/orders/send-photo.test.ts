import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ order: null as unknown, view: null as unknown, filters: [] as unknown[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: () => {
  const q = { select: () => q, eq: (...a: unknown[]) => { m.filters.push(a); return q; }, maybeSingle: async () => ({ data: m.order, error: null }) };
  return q;
} }) }));
vi.mock("@/lib/integrations/zana", () => ({ fetchExternalOrder: vi.fn(async () => m.view) }));
import { orderPhotoToSend } from "./send-photo";

const orderId = "11111111-1111-4111-8111-111111111111";
const url = "https://store.test/order-photos/ord_1/item-0-img100.jpg";
beforeEach(() => {
  m.filters = [];
  m.order = { external_system: "external", external_order_id: "ord_1" };
  m.view = { status: "pending", items: [{ item: 1, productName: "Puzzle", files: [
    { key: "photo", role: "input", url: "https://store.test/customer.jpg" }, { key: "processed", role: "output", url }] }] };
});

it("sends only the store's own photo of an item of this conversation's order, as the website has it now", async () => {
  expect(await orderPhotoToSend("business", "conversation", { orderId, item: 1, key: "processed", url })).toBe(url);
  expect(m.filters).toEqual(expect.arrayContaining([["business_id", "business"], ["conversation_id", "conversation"]]));
});

it("refuses the customer's photo, another URL, another item, and an order not on the website", async () => {
  expect(await orderPhotoToSend("b", "c", { orderId, item: 1, key: "photo", url: "https://store.test/customer.jpg" })).toBeNull();
  expect(await orderPhotoToSend("b", "c", { orderId, item: 1, key: "processed", url: "https://evil.test/x.jpg" })).toBeNull();
  expect(await orderPhotoToSend("b", "c", { orderId, item: 2, key: "processed", url })).toBeNull();
  expect(await orderPhotoToSend("b", "c", { orderId: "x", item: 1, key: "processed", url })).toBeNull();
  m.order = { external_system: null, external_order_id: null };
  expect(await orderPhotoToSend("b", "c", { orderId, item: 1, key: "processed", url })).toBeNull();
});
