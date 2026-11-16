import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ product: null as unknown, filters: [] as unknown[], signed: vi.fn(), order: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({
  from: () => {
    const q = { select: () => q, eq: (...a: unknown[]) => { m.filters.push(a); return q; }, is: () => q, maybeSingle: async () => ({ data: m.product, error: null }) };
    return q;
  },
  storage: { from: () => ({ createSignedUrl: m.signed }) },
}) }));
vi.mock("@/lib/orders/send-photo", () => ({ orderPhotoToSend: m.order }));
import { staffPhotoToSend } from "./staff-photo";

const business = "10000000-0000-4000-8000-000000000001", conversation = "20000000-0000-4000-8000-000000000001";
const file = "30000000-0000-4000-8000-000000000001", product = "40000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  m.filters = [];
  m.product = { image_url: "https://shop.test/p.jpg" };
  m.signed.mockResolvedValue({ data: { signedUrl: "https://files.test/signed?token=1" }, error: null });
  m.order.mockResolvedValue("https://store.test/processed.jpg");
});

it("an order photo keeps its URL as identity, as before", async () => {
  const media = { orderId: "x", item: 1, key: "processed", url: "https://store.test/processed.jpg" };
  expect(await staffPhotoToSend(business, conversation, media)).toEqual({ url: "https://store.test/processed.jpg", identity: "https://store.test/processed.jpg" });
  expect(m.order).toHaveBeenCalledWith(business, conversation, media);
  m.order.mockResolvedValue(null);
  expect(await staffPhotoToSend(business, conversation, { kind: "order" })).toBeNull();
});

it("an upload of this conversation goes through a short link; the identity is its path", async () => {
  const path = `${business}/${conversation}/${file}.jpg`;
  expect(await staffPhotoToSend(business, conversation, { kind: "upload", path })).toEqual({ url: "https://files.test/signed?token=1", identity: `upload:${path}` });
  expect(m.signed).toHaveBeenCalledWith(path, 3600);
});

it.each([
  ["another business", `50000000-0000-4000-8000-000000000001/${conversation}/${file}.jpg`],
  ["another conversation", `${business}/50000000-0000-4000-8000-000000000001/${file}.jpg`],
  ["a deeper path", `${business}/${conversation}/x/${file}.jpg`],
  ["a non-uuid name", `${business}/${conversation}/../${file}.jpg`],
  ["HEIC, which the channels do not show", `${business}/${conversation}/${file}.heic`],
])("refuses an upload from %s", async (_, path) => {
  expect(await staffPhotoToSend(business, conversation, { kind: "upload", path })).toBeNull();
  expect(m.signed).not.toHaveBeenCalled();
});

it("a missing upload is refused", async () => {
  m.signed.mockResolvedValue({ data: null, error: { message: "not found" } });
  expect(await staffPhotoToSend(business, conversation, { kind: "upload", path: `${business}/${conversation}/${file}.png` })).toBeNull();
});

it("a product photo is read from this business's active product", async () => {
  expect(await staffPhotoToSend(business, conversation, { kind: "product", productId: product, url: "https://evil.test/x.jpg" }))
    .toEqual({ url: "https://shop.test/p.jpg", identity: `product:${product}:https://shop.test/p.jpg` });
  expect(m.filters).toEqual(expect.arrayContaining([["id", product], ["business_id", business], ["is_active", true]]));
});

it("a product without an https photo, or an unknown one, is refused", async () => {
  m.product = { image_url: "http://shop.test/p.jpg" };
  expect(await staffPhotoToSend(business, conversation, { kind: "product", productId: product })).toBeNull();
  m.product = null;
  expect(await staffPhotoToSend(business, conversation, { kind: "product", productId: product })).toBeNull();
  expect(await staffPhotoToSend(business, conversation, { kind: "product", productId: "x" })).toBeNull();
  expect(await staffPhotoToSend(business, conversation, { kind: "url", url: "https://x.test/a.jpg" })).toBeNull();
});
