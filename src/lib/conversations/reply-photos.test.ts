import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ products: [] as unknown[], sent: [] as unknown[], error: null as unknown, sendText: vi.fn(), sendImage: vi.fn(), filters: [] as unknown[][] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  const chain = { select: () => chain, eq: (...v: unknown[]) => { m.filters.push([table, ...v]); return chain; }, in: () => chain, is: (...v: unknown[]) => { m.filters.push([table, "is", ...v]); return chain; },
    not: () => chain, order: () => chain, limit: async () => ({ data: m.sent, error: m.error }),
    then: (f: (v: unknown) => unknown) => Promise.resolve({ data: m.products, error: m.error }).then(f) };
  return chain;
} }) }));
vi.mock("@/lib/instagram/send", () => ({ sendInstagramText: m.sendText, sendInstagramImage: m.sendImage }));
vi.mock("@/lib/whatsapp/api", () => ({ sendWhatsAppText: m.sendText, sendWhatsAppImage: m.sendImage }));
import { replyProductPhotos, sendReplyWithPhotos } from "./reply-photos";
import { defaultCommunicationPolicy } from "@/lib/agents/communication-policy";
import type { PartObserver } from "./delivery-status";

const business = "00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
beforeEach(() => { vi.clearAllMocks(); m.products = []; m.sent = []; m.error = null; m.filters = []; });

it("selects only stored https photos of the presented products, in reply order, within the business, at most three", async () => {
  m.products = [{ id: id(2), image_url: " https://cdn.test/b.jpg " }, { id: id(1), image_url: "https://cdn.test/a.jpg" }, { id: id(3), image_url: "http://cdn.test/plain.jpg" },
    { id: id(4), image_url: null }, { id: id(5), image_url: "https://cdn.test/e.jpg" }, { id: id(6), image_url: "https://cdn.test/f.jpg" }];
  const photos = await replyProductPhotos({ businessId: business, productIds: [id(1), id(2), id(3), id(4), id(1), id(5), id(6), "not-an-id"] });
  expect(photos).toEqual([{ productId: id(1), url: "https://cdn.test/a.jpg" }, { productId: id(2), url: "https://cdn.test/b.jpg" }, { productId: id(5), url: "https://cdn.test/e.jpg" }]);
  expect(m.filters).toContainEqual(["products", "business_id", business]);
  expect(m.filters).toContainEqual(["products", "is_active", true]);
  expect(m.filters).toContainEqual(["products", "is", "archived_at", null]);
});

it("does not resend a photo this conversation already received and sends none when the business turned photos off", async () => {
  m.products = [{ id: id(1), image_url: "https://cdn.test/a.jpg" }, { id: id(2), image_url: "https://cdn.test/b.jpg" }];
  m.sent = [{ media: [{ kind: "image", sourceUrl: "https://cdn.test/a.jpg" }] }, { media: null }];
  expect(await replyProductPhotos({ businessId: business, productIds: [id(1), id(2)], conversationId: "c" })).toEqual([{ productId: id(2), url: "https://cdn.test/b.jpg" }]);
  expect(await replyProductPhotos({ businessId: business, productIds: [id(1), id(2)], communication: { ...defaultCommunicationPolicy, productPhotos: "off" } })).toEqual([]);
});

it("leaves the reply as text when the catalog cannot be read", async () => {
  m.products = [{ id: id(1), image_url: "https://cdn.test/a.jpg" }];
  m.error = { code: "timeout" };
  expect(await replyProductPhotos({ businessId: business, productIds: [id(1)], conversationId: "c" })).toEqual([]);
});

const relay = (body: string, status: "sent" | "failed" | "uncertain", messageId?: string) => async (p: { onPart?: PartObserver; url?: string }) => {
  await p.onPart?.({ index: 0, body: p.url ?? body, status: "sending" }, 1);
  await p.onPart?.({ index: 0, body: p.url ?? body, status, ...(messageId ? { messageId } : {}) }, 1);
  return status === "sent" ? { ok: true as const, messageId, parts: [] } : { ok: false as const, error: status, parts: [{ index: 0, body: p.url ?? body, status }] };
};

it("numbers text and photos as parts of one reply and returns the last confirmed receipt", async () => {
  const parts: [number, number, string][] = [];
  m.sendText.mockImplementation(relay("Ja", "sent", "text"));
  m.sendImage.mockImplementationOnce(relay("", "sent", "p1")).mockImplementationOnce(relay("", "sent", "p2"));
  const result = await sendReplyWithPhotos({ channel: "whatsapp", accountId: "a", token: "t", to: "u", body: "Ja", photos: [{ url: "https://cdn.test/a.jpg" }, { url: "https://cdn.test/b.jpg" }],
    onPart: async (part, total) => { parts.push([part.index, total, part.status]); } });
  expect(result).toEqual({ ok: true, messageId: "p2" });
  expect(parts).toEqual([[0, 3, "sending"], [0, 3, "sent"], [1, 3, "sending"], [1, 3, "sent"], [2, 3, "sending"], [2, 3, "sent"]]);
  expect(m.sendImage).toHaveBeenNthCalledWith(1, expect.not.objectContaining({ caption: expect.anything() }));
});

it("sends no photo when the text was not confirmed, and stops on a photo with an unknown result", async () => {
  m.sendText.mockImplementation(relay("Ja", "uncertain"));
  expect((await sendReplyWithPhotos({ channel: "instagram", accountId: "a", token: "t", to: "u", body: "Ja", photos: [{ url: "https://cdn.test/a.jpg" }] })).ok).toBe(false);
  expect(m.sendImage).not.toHaveBeenCalled();
  m.sendText.mockImplementation(relay("Ja", "sent", "text"));
  m.sendImage.mockImplementationOnce(relay("", "uncertain"));
  const result = await sendReplyWithPhotos({ channel: "instagram", accountId: "a", token: "t", to: "u", body: "Ja", photos: [{ url: "https://cdn.test/a.jpg" }, { url: "https://cdn.test/b.jpg" }] });
  expect(result.ok).toBe(false);
  expect(m.sendImage).toHaveBeenCalledOnce();
});

it("keeps the delivered text and the other photos when the channel rejects one photo", async () => {
  m.sendText.mockImplementation(relay("Ja", "sent", "text"));
  m.sendImage.mockImplementationOnce(relay("", "failed")).mockImplementationOnce(relay("", "sent", "p2"));
  const result = await sendReplyWithPhotos({ channel: "instagram", accountId: "a", token: "t", to: "u", body: "Ja", photos: [{ url: "https://cdn.test/a.jpg" }, { url: "https://cdn.test/b.jpg" }] });
  expect(result).toEqual({ ok: true, messageId: "p2" });
  expect(m.sendImage).toHaveBeenCalledTimes(2);
});
