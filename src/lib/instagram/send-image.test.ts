import { afterEach, expect, it, vi } from "vitest";
import { sendInstagramImage } from "./send";
import { sendWhatsAppImage } from "@/lib/whatsapp/api";

afterEach(() => vi.unstubAllGlobals());
const params = { accountId: "ig", token: "t", to: "person", url: "https://store.test/p.jpg" };

it("sends the photo by its URL, then the caption, recording each part before the next", async () => {
  const send = vi.fn().mockResolvedValueOnce(Response.json({ message_id: "m1" })).mockResolvedValueOnce(Response.json({ message_id: "m2" }));
  vi.stubGlobal("fetch", send);
  const parts: unknown[] = [];
  const result = await sendInstagramImage({ ...params, caption: "Ja si do dalë", onPart: async (part) => { parts.push(part.status); } });
  expect(result).toMatchObject({ ok: true, messageId: "m2" });
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ recipient: { id: "person" }, message: { attachment: { type: "image", payload: { url: "https://store.test/p.jpg", is_reusable: false } } } });
  expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({ recipient: { id: "person" }, message: { text: "Ja si do dalë" } });
  expect(parts).toEqual(["sending", "sent", "sending", "sent"]);
});

it("stops after a photo with an unknown result and never sends the caption", async () => {
  const send = vi.fn().mockRejectedValue(new Error("timeout"));
  vi.stubGlobal("fetch", send);
  const result = await sendInstagramImage({ ...params, caption: "Ja si do dalë" });
  expect(result).toMatchObject({ ok: false, parts: [{ index: 0, status: "uncertain" }] });
  expect(send).toHaveBeenCalledTimes(1);
});

it("keeps the staff window: HUMAN_AGENT after 24 hours, nothing after 7 days", async () => {
  const send = vi.fn().mockResolvedValue(Response.json({ message_id: "m1" }));
  vi.stubGlobal("fetch", send);
  await sendInstagramImage({ ...params, humanAgent: { lastInboundAt: new Date(Date.now() - 30 * 3600_000).toISOString() } });
  expect(JSON.parse(send.mock.calls[0][1].body).tag).toBe("HUMAN_AGENT");
  const closed = await sendInstagramImage({ ...params, humanAgent: { lastInboundAt: new Date(Date.now() - 8 * 24 * 3600_000).toISOString() } });
  expect(closed.ok).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
  expect(await sendInstagramImage({ ...params, url: "http://store.test/p.jpg" })).toMatchObject({ ok: false });
});

it("sends a WhatsApp photo with its caption once", async () => {
  const send = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.1" }] }));
  vi.stubGlobal("fetch", send);
  const result = await sendWhatsAppImage({ ...params, caption: "Ja si do dalë" });
  expect(result).toMatchObject({ ok: true, messageId: "wamid.1" });
  expect(JSON.parse(send.mock.calls[0][1].body)).toMatchObject({ type: "image", image: { link: "https://store.test/p.jpg", caption: "Ja si do dalë" } });
  expect(await sendWhatsAppImage({ ...params, caption: "x".repeat(1025) })).toMatchObject({ ok: false });
  expect(send).toHaveBeenCalledTimes(1);
});
