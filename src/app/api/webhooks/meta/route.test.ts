import { createHmac } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ enqueue: vi.fn(), run: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/conversations/workflow-queue", () => ({ enqueueWorkflowMessage: m.enqueue, runWorkflowQueue: m.run }));
vi.mock("@/lib/conversations/handle-inbound", () => ({ handleInboundMessage: vi.fn() }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: m.after }));
import { GET, POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("META_APP_SECRET", "meta-secret"); vi.stubEnv("INSTAGRAM_APP_SECRET", "ig-secret"); vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-me"); m.enqueue.mockResolvedValue(true); });
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
