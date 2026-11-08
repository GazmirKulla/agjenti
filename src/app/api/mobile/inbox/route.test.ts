import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ identity: vi.fn(), access: vi.fn(), rpc: vi.fn(), rows: vi.fn(), conversation: vi.fn(), messages: vi.fn() }));
vi.mock("@/lib/auth/read-client", () => ({ authenticatedReadClient: m.identity }));
vi.mock("@/lib/tenant/access", () => ({ requireBusinessAccess: m.access }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ service: true }) }));
vi.mock("@/lib/conversations/inbox-read", async (original) => ({
  ...await original<typeof import("@/lib/conversations/inbox-read")>(),
  loadInboxRows: m.rows, loadThreadConversation: m.conversation, loadThreadMessages: m.messages,
}));
import { GET as list } from "./route";
import { GET as thread } from "./[conversationId]/route";
import { InboxReadError } from "@/lib/conversations/inbox-read";

const business = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const req = (path = "/api/mobile/inbox?slug=shop") => new Request(`https://agjenti.test${path}`, { headers: { authorization: "Bearer token" } });
const ctx = (id = conversationId) => ({ params: Promise.resolve({ conversationId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.identity.mockResolvedValue({ user: { id: "user" }, db: { rpc: m.rpc } });
  m.access.mockResolvedValue({ business: { id: business } });
  m.rpc.mockResolvedValue({ data: true, error: null });
  m.rows.mockResolvedValue([{ id: conversationId, name: "Ana" }]);
  m.conversation.mockResolvedValue({ id: conversationId, name: "Ana", handle: "@ana", status: "active", channel: "whatsapp", last_inbound_at: null, customer: null });
  m.messages.mockResolvedValue([]);
});

describe("native inbox access", () => {
  it("reads the list for the verified member of the requested business only", async () => {
    const response = await list(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ businessId: business, conversations: [{ id: conversationId, name: "Ana" }] });
    expect(m.access).toHaveBeenCalledWith("user", "shop");
    expect(m.rpc).toHaveBeenCalledWith("current_user_module_allowed", { p_business: business, p_module: "inbox" });
    expect(m.rows).toHaveBeenCalledWith({ service: true }, business);
  });
  it("refuses missing identity, foreign businesses and a disabled inbox module before reading", async () => {
    m.identity.mockResolvedValueOnce(null);
    expect((await list(req())).status).toBe(401);
    m.access.mockResolvedValueOnce(null);
    expect((await list(req())).status).toBe(403);
    m.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await thread(req(), ctx())).status).toBe(403);
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    expect((await list(req())).status).toBe(503);
    expect(m.rows).not.toHaveBeenCalled();
    expect(m.conversation).not.toHaveBeenCalled();
  });
  it("returns 404 for a malformed id or a conversation outside the business", async () => {
    expect((await thread(req(), ctx("not-a-uuid"))).status).toBe(404);
    expect(m.identity).not.toHaveBeenCalled();
    m.conversation.mockResolvedValueOnce(null);
    expect((await thread(req(), ctx())).status).toBe(404);
    expect(m.messages).not.toHaveBeenCalled();
  });
  it("reports a controlled failure when reads fail", async () => {
    m.rows.mockRejectedValueOnce(new InboxReadError("list_unavailable"));
    expect((await list(req())).status).toBe(503);
  });
  it("passes only https attachments and the reply window to the app", async () => {
    m.conversation.mockResolvedValueOnce({ id: conversationId, name: "Ana", handle: "@ana", status: "active", channel: "instagram", last_inbound_at: new Date(Date.now() - 2 * 864e5).toISOString(), customer: null });
    m.messages.mockResolvedValueOnce([{ id: "m1", direction: "inbound", source: "customer", body: null, created_at: "2026-11-08T10:00:00Z", delivery_status: null, delivery_error: null, transport_request_id: null,
      media: [{ kind: "image", sourceUrl: "https://cdn.test/a.jpg" }, { kind: "image", sourceUrl: "javascript:alert(1)" }, { kind: "document", sourceUrl: "http://cdn.test/b.pdf" }] }]);
    const body = await (await thread(req(), ctx())).json();
    expect(body.conversation.replyWindow).toBe("human_agent");
    expect(body.messages[0].attachments).toEqual([{ kind: "image", url: "https://cdn.test/a.jpg", filename: null, caption: null }]);
    expect(m.messages).toHaveBeenCalledWith({ service: true }, business, conversationId);
  });
});
