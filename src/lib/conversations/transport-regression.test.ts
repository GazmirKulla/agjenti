import { afterEach, describe, expect, it, vi } from "vitest";
import { sendInstagramText } from "@/lib/instagram/send";
import { inboxHistory } from "./inbox-history";
import { sendWhatsAppText } from "@/lib/whatsapp/api";

afterEach(() => vi.unstubAllGlobals());
describe("message transport regressions (synthetic provider, no network)", () => {
  it.each([sendInstagramText, sendWhatsAppText])("distinguishes an explicit provider rejection from an ambiguous server failure", async send => {
    const params={accountId:"synthetic",token:"synthetic",to:"synthetic",body:"synthetic"};
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(Response.json({error:{code:100,message:"synthetic rejection"}},{status:400})).mockResolvedValueOnce(Response.json({error:{code:2,message:"synthetic server failure"}},{status:500})));
    expect(await send(params)).toMatchObject({ok:false,parts:[{status:"failed"}]});
    expect(await send(params)).toMatchObject({ok:false,parts:[{status:"uncertain"}]});
  });
  it("does not send another part when persistence of an accepted part fails", async () => {
    const fetch=vi.fn().mockResolvedValue(Response.json({message_id:"accepted"}));vi.stubGlobal("fetch",fetch);
    await expect(sendInstagramText({accountId:"synthetic",token:"synthetic",to:"synthetic",body:"word ".repeat(650),onPart:async part=>{if(part.status==="sent")throw new Error("DB unavailable");}})).rejects.toThrow("DB unavailable");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("retains every provider ID in a multipart reply", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message_id: `part-${++n}` })));
    const result = await sendInstagramText({ accountId: "synthetic", token: "synthetic", to: "synthetic", body: "word ".repeat(650) });
    expect(result).toMatchObject({ ok: true, parts: Array.from({ length: n }, (_, i) => ({ index: i, messageId: `part-${i + 1}`, status: "sent" })) });
    expect(n).toBeGreaterThan(1);
  });
  it("retains an accepted part when the following request times out, without sending later parts", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ message_id: "accepted" })).mockRejectedValueOnce(new Error("timeout"));
    vi.stubGlobal("fetch", fetch);
    const result = await sendInstagramText({ accountId: "synthetic", token: "synthetic", to: "synthetic", body: "word ".repeat(650) });
    expect(result).toMatchObject({ ok: false, parts: [{ index: 0, messageId: "accepted", status: "sent" }, { index: 1, status: "uncertain" }] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["sent", "delivered", "read"])("retains %s assistant history and staff ownership", status => {
    const history = inboxHistory([{ body: "Përgjigjja e stafit", direction: "outbound", source: "staff", delivery_status: status, external_message_id: "synthetic" }], new Set());
    expect(history.staffReplied).toBe(true);
    expect(history.messages).toEqual([{ role: "assistant", content: "[Stafi] Përgjigjja e stafit" }]);
  });
});
