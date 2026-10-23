import { afterEach, expect, it, vi } from "vitest";
import { sendWhatsAppText } from "./api";
afterEach(() => vi.unstubAllGlobals());
const input = { accountId: "123456", token: "private-token", to: "355691234567", body: "Përshëndetje" };
it("uses the WhatsApp transport and bearer token, returning Meta's receipt", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.sent" }] })); vi.stubGlobal("fetch", fetcher);
  expect(await sendWhatsAppText(input)).toMatchObject({ ok: true, messageId: "wamid.sent", parts: [{ messageId: "wamid.sent", status: "sent" }] });
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toMatch(/^https:\/\/graph.facebook.com\/v[\d.]+\/123456\/messages$/);
  expect(url).not.toContain(input.token);
  expect(request.headers.Authorization).toBe("Bearer private-token");
  expect(JSON.parse(request.body)).toMatchObject({ messaging_product: "whatsapp", to: input.to, text: { body: input.body } });
});
it("does not retry an ambiguous send or leak the token in errors", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("private-token")); vi.stubGlobal("fetch", fetcher);
  const result = await sendWhatsAppText(input);
  expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain(input.token); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects missing receipts, empty text, and oversized messages", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
  expect((await sendWhatsAppText(input)).ok).toBe(false);
  expect((await sendWhatsAppText({ ...input, body: " " })).ok).toBe(false);
  expect((await sendWhatsAppText({ ...input, body: "a".repeat(4097) })).ok).toBe(false);
});
