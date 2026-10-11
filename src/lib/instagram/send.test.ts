import { afterEach, expect, it, vi } from "vitest";
import { sendInstagramText } from "./send";
afterEach(() => vi.unstubAllGlobals());
const params = { accountId: "account", token: "secret", to: "person", body: "Hello" };
it.each([{}, { message_id: "" }, { message_id: 42 }])("requires a usable receipt for every Instagram chunk: %j", async data => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
  expect((await sendInstagramText(params)).ok).toBe(false);
});
it("does not retry or send later chunks after a missing receipt", async () => {
  const send = vi.fn().mockResolvedValueOnce(Response.json({ message_id: "first" })).mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal("fetch", send);
  expect((await sendInstagramText({ ...params, body: "word ".repeat(1000) })).ok).toBe(false);
  expect(send).toHaveBeenCalledTimes(2);
});
it("returns the provider receipt after confirmed delivery", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message_id: "confirmed" })));
  expect(await sendInstagramText(params)).toEqual({ ok: true, messageId: "confirmed" });
});
