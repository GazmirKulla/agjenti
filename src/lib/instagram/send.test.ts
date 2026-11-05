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
  expect(await sendInstagramText(params)).toMatchObject({ ok: true, messageId: "confirmed", parts: [{ messageId: "confirmed", status: "sent" }] });
});

it.each([23, 24, 167, 168])("uses the human tag only inside the manual extension (%s hours)", async hours => {
 const send = vi.fn().mockResolvedValue(Response.json({message_id:"confirmed"})); vi.stubGlobal("fetch",send);
 const result = await sendInstagramText({...params,humanAgent:{lastInboundAt:new Date(Date.now()-hours*3600000).toISOString()}});
 if(hours>=168) {expect(result.ok).toBe(false); expect(send).not.toHaveBeenCalled();}
 else {expect(result.ok).toBe(true); const body=JSON.parse(send.mock.calls[0][1].body); expect(body.tag).toBe(hours>=24?"HUMAN_AGENT":undefined);}
});
it("ordinary sends never acquire a Human Agent tag", async () => {
 const send=vi.fn().mockResolvedValue(Response.json({message_id:"confirmed"}));vi.stubGlobal("fetch",send);
 await sendInstagramText(params); expect(JSON.parse(send.mock.calls[0][1].body)).not.toHaveProperty("tag");
});
