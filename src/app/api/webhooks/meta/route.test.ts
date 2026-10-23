import { createHmac } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ enqueue: vi.fn(), run: vi.fn(), after: vi.fn(), handle: vi.fn(), receipts: vi.fn() }));
vi.mock("@/lib/conversations/provider-receipts", async original => ({ ...await original<typeof import("@/lib/conversations/provider-receipts")>(), persistProviderReceipts: m.receipts }));
vi.mock("@/lib/conversations/workflow-queue", () => ({ enqueueWorkflowMessage: m.enqueue, runWorkflowQueue: m.run }));
vi.mock("@/lib/conversations/handle-inbound", () => ({ handleInboundMessage: m.handle }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: m.after }));
import { GET, POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("META_APP_SECRET", "meta-secret"); vi.stubEnv("INSTAGRAM_APP_SECRET", "ig-secret"); vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-me"); m.enqueue.mockResolvedValue(true); m.receipts.mockResolvedValue(undefined); });
const payload = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "123456" }, messages: [{ id: "wamid.one", from: "355691234567", type: "text", text: { body: "Hello" }, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] };
function request(secret = "meta-secret") { const body = JSON.stringify(payload); return new Request("https://app.test/api/webhooks/meta", { method: "POST", body, headers: { "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(body).digest("hex") } }); }
it("accepts WhatsApp with the Meta secret and persists before acknowledging", async () => {
 expect((await POST(request())).status).toBe(200);
 expect(m.enqueue).toHaveBeenCalledWith(expect.objectContaining({ channel: "whatsapp", externalMessageId: "wamid.one" }));
 expect(m.after).toHaveBeenCalledOnce();
});
it("rejects WhatsApp signed with only the Instagram secret", async () => { expect((await POST(request("ig-secret"))).status).toBe(401); expect(m.enqueue).not.toHaveBeenCalled(); });
it("asks Meta to retry when durable persistence fails", async () => { m.enqueue.mockRejectedValue(new Error("database unavailable")); expect((await POST(request())).status).toBe(503); });
it("verifies the shared callback using the configured challenge token", async () => { const result = await GET(new Request("https://app.test/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=123")); expect(result.status).toBe(200); expect(await result.text()).toBe("123"); });

function instagramRequest() {
 const body = JSON.stringify({ object: "instagram", entry: [{ id: "account", messaging: ["first", "second"].map(mid => ({ sender: { id: "customer" }, recipient: { id: "account" }, timestamp: Date.now(), message: { mid, text: mid } })) }] });
 return new Request("https://app.test/api/webhooks/meta", { method: "POST", body, headers: { "x-hub-signature-256": "sha256=" + createHmac("sha256", "ig-secret").update(body).digest("hex") } });
}
it("persists rapid Instagram messages in order before acknowledgment, without direct execution", async () => {
 expect((await POST(instagramRequest())).status).toBe(200);
 expect(m.enqueue.mock.calls.map(([message]) => message.externalMessageId)).toEqual(["first", "second"]);
 expect(m.handle).not.toHaveBeenCalled();
 expect(m.run).not.toHaveBeenCalled();
 await m.after.mock.calls[0][0]();
 expect(m.run).toHaveBeenCalledOnce();
});
it("does not fall back to unversioned processing for unknown Instagram accounts", async () => {
 m.enqueue.mockResolvedValue(false);
 expect((await POST(instagramRequest())).status).toBe(200);
 await m.after.mock.calls[0][0]();
 expect(m.handle).not.toHaveBeenCalled();
});
it("returns 503 when Instagram persistence fails, so Meta can retry", async () => {
 m.enqueue.mockRejectedValue(new Error("database unavailable"));
 expect((await POST(instagramRequest())).status).toBe(503);
 expect(m.after).not.toHaveBeenCalled();
 expect(m.handle).not.toHaveBeenCalled();
});

it.each(["instagram", "whatsapp_business_account"])("validates %s receipt signature before writes and never routes receipts as messages", async object => {
 const body = JSON.stringify(object === "instagram" ? { object, entry:[{id:"account",messaging:[{sender:{id:"customer"},recipient:{id:"account"},timestamp:Date.now(),read:{mid:"part-id"}}]}] }
  : { object, entry:[{changes:[{field:"messages",value:{metadata:{phone_number_id:"account"},statuses:[{id:"part-id",recipient_id:"customer",status:"read",timestamp:String(Math.floor(Date.now()/1000))}]}}]}] });
 const signed = (secret:string)=>new Request("https://app.test/api/webhooks/meta",{method:"POST",body,headers:{"x-hub-signature-256":"sha256="+createHmac("sha256",secret).update(body).digest("hex")}});
 expect((await POST(signed("wrong-secret"))).status).toBe(401);expect(m.receipts).not.toHaveBeenCalled();
 const secret=object === "instagram" ? "ig-secret" : "meta-secret";
 expect((await POST(signed(secret))).status).toBe(200);
 expect(m.receipts).toHaveBeenCalledWith([expect.objectContaining({messageId:"part-id",participantId:"customer",accountId:"account",status:"read"})]);
 expect(m.enqueue).not.toHaveBeenCalled();expect(m.handle).not.toHaveBeenCalled();
 m.receipts.mockRejectedValueOnce(new Error("synthetic DB outage"));
 expect((await POST(signed(secret))).status).toBe(503);
});
